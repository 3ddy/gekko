// helpers
var _ = require('lodash');
var log = require('../core/log');
var fs = require('fs');

var SO = require('./indicators/SO.js');
var BB = require('./indicators/BB.js');
// let's create our own method
var method = {};

// prepare everything our method needs
method.init = function() {
  this.requiredHistory = this.tradingAdvisor.historySize;
  this.addIndicator('so', 'SO', this.settings.fstochrsi);
  this.addIndicator('bb', 'BB', this.settings.bbands);
  //Aggregated Indicator variables
  this.aggPrevClose = null;
  this.aggAvgLoss = [];
  this.aggAvgGain = [];
  this.aggPrevAvg = {
    gain: null,
    loss: null,
    k: null,
    d: null
  };
  this.aggRSIHistory = [];
  this.aggAvgK = [];
  this.aggAvgD = [];
  this.aggCandlesNum = this.settings.candles;
  this.acandle = null;

  this.weights = this.settings.weights;
  this.dweight = this.weights.pop();
  this.candles = [];

  this.age = 0;
  this.prevCandle = {
    close: 0,
    buyevent: 0 // -1 SELL 0 none or emergency sell 1 BUY
  };
  this.trend = {
    direction: 'none',
    duration: 0,
    persisted: false,
    adviced: false
  };
  //second conditional persistence
  this.strend = {
    direction: 'none',
    duration: 0,
    persisted: false,
    adviced: false
  };
  //Emergency sell persistence
  this.selltrend = {
    duration: 0,
    persisted: false,
    adviced: false
  };
  this.SO = this.indicators.so;
  //this.SOA = this.indicators.so;
  try {
    fs.unlinkSync('candles.txt');
  } catch (e) {

  }
  this.fd = fs.openSync('candles.txt','a');
  fs.appendFileSync(this.fd,
    "start;open;high;low;close;rsi;k;avgK;avgD\n",
    'utf8');
}

// what happens on every new candle?
method.update = function(candle) {
  //TODO: candle aggregating
  /**
   * only candle.close is needed
   * this.settings.fstochrsi.interval - 1 * this.settings.candles for avgLoss/Gain
   */
  log.debug('candle',candle);
  log.debug('age',this.age);

  var rsisize = this.settings.fstochrsi.interval;
  var stochsize = this.settings.fstochrsi.stoch;
  var ksize = this.settings.fstochrsi.k;
  var dsize = this.settings.fstochrsi.d;

  if (this.aggPrevClose === null) {
    this.aggPrevClose = candle.close;
  }
  //Calculation gain/loss and storing for history
  if (this.age % this.settings.candles == 0) {
    var gain = 0;
    var loss = 0;
    if (candle.close > this.aggPrevClose) {
      gain = candle.close - this.aggPrevClose;
      loss = 0;
    } else {
      loss = this.aggPrevClose - candle.close;
      gain = 0;
    }
    this.aggAvgGain.push(gain);
    this.aggAvgLoss.push(loss);
  }

  //Calculating RS and RSI with Wilder's smoothing average
  if (this.aggAvgGain.length > rsisize) {
    this.aggAvgGain.shift();
    log.debug('this.aggAvgGain',this.aggAvgGain);
    this.aggAvgLoss.shift();
    var rs = 0;
    var rsi = 0;
    //First RSI calculation
    if (this.aggPrevAvg.gain === null) {
      this.aggPrevAvg.gain = this.aggAvgGain.reduce((sum,p) => sum + p,0) / _.size(this.aggAvgGain);
      this.aggPrevAvg.loss = this.aggAvgLoss.reduce((sum,p) => sum + p,0) / _.size(this.aggAvgLoss);
      rs = this.aggPrevAvg.gain / this.aggPrevAvg.loss;
    } else {
      this.aggPrevAvg.gain = (this.aggPrevAvg.gain * (rsisize - 1) + this.aggAvgGain.slice(-1)[0]) / rsisize;
      this.aggPrevAvg.loss = (this.aggPrevAvg.loss * (rsisize - 1) + this.aggAvgLoss.slice(-1)[0]) / rsisize;
      rs = this.aggPrevAvg.gain / this.aggPrevAvg.loss;
    }
    rsi = 100 - 100 / (1 + rs);
    //RSI=100 if average loss is 0 by definition
    if (this.aggPrevAvg.loss === 0 && this.aggPrevAvg.gain !== 0){
      rsi = 100;
    } else if (this.aggPrevAvg.loss === 0){
      rsi = 0;
    }
    this.aggRSIHistory.push(rsi);
    //Calculating Full StochascticRSI with exponential moving average
    if (this.aggRSIHistory.length > stochsize) {
      this.aggRSIHistory.shift();
      var min = _.min(this.aggRSIHistory);
      var max = _.max(this.aggRSIHistory);
      this.aggAvgK.push(
        (rsi - min) / (max - min) * 100
      );
      if (this.aggAvgK.length > ksize){
        this.aggAvgK.shift();
        //First %K calculation
        if (this.aggPrevAvg.k === null) {
          this.aggPrevAvg.k = this.aggAvgK.reduce((sum,p) => sum + p,0) / _.size(this.aggAvgK);
        } else {
          //N = number of days in EMA, k = 2 / (N+1)
          var k = 2 / (ksize + 1);
          //EMA = Value(t) * k + EMA(t-1) * (1 – k)
          this.aggPrevAvg.k = this.aggAvgK.slice(-1)[0] * k + this.aggPrevAvg.k * (1 - k);
        }
        this.aggAvgD.push(this.aggPrevAvg.k);
        if (this.aggAvgD.length > dsize) {
          this.aggAvgD.shift();
          //First %D calculation
          if (this.aggPrevAvg.d === null) {
            this.aggPrevAvg.d = this.aggAvgK.reduce((sum,p) => sum + p,0) / _.size(this.aggAvgD);
          } else {
            //N = number of days in EMA, k = 2 / (N+1)
            var k = 2 / (dsize + 1);
            //EMA = Value(t) * k + EMA(t-1) * (1 – k)
            this.aggPrevAvg.d = this.aggAvgD.slice(-1)[0] * k + this.aggPrevAvg.d * (1 - k);
          }
        }
      }
    }
  }
  this.age++;
  /*this.candles.push(candle);
  if (this.candles.length > this.aggCandlesNum) {
    this.candles.shift();
  }
  this.acandle = {
    'open': _.first(this.candles).open,
    'low': _.min(this.candles,function(candle) {
      return candle.low;
    }).low,
    'high': _.max(this.candles,function(candle) {
        return candle.high;
      }).high,
    'close': candle.close,
    'volume': this.candles.reduce((sum,c) => sum + c.volume,0),
    'trades': this.candles.reduce((sum,c) => sum + c.trades,0)
  };*/

/*  log.debug('this.age',this.age);
  this.candles[this.age] = candle;
  log.debug('this.candles',this.candles);
  if (this.candles.length < this.aggregatenum){
    this.acandle = {
      'open': this.candles[0].open || candle.open,
      'low':_.min(this.candles,function(candle) {
        return candle.low;
      }),
      'high':_.max(this.candles,function(candle) {
          return candle.high;
        }
      ),
      'close': candle.close
    }
  } else {
    this.acandle = {
      'open':this.candles[this.age].open,
      'low':_.min(this.candles,function(candle) {
        return candle.low;
      }),
      'high':_.max(this.candles,function(candle) {
          return candle.high;
        }
      ),
      'close': this.candles[this.age+1].close
    }
    this.age = (this.age +1) % this.aggregatenum;
    log.debug('this.age',this.age);
    */
  //  log.debug('this.candles',this.candles);
   // log.debug('this.acandle',this.acandle);
 // this.SOA.update(this.acandle);
  //}


}

// for debugging purposes log the last
// calculated parameters.
method.log = function(candle) {
  var digits = 8;
  //BB
  var BB = this.indicators.bb;
  //BB.lower; BB.upper; BB.middle are your line values


  //SO.d.result SO.k (fast %K) SO.result = SO.avgK.result (full %K)
  /*log.debug('SO.d: ', this.SO.d.result.toFixed(digits));
  log.debug("SO.k: " + this.SO.k.toFixed(digits));
  log.debug("SO.result: " + this.SO.result.toFixed(digits));
  log.debug("SO.avgK.result: " + this.SO.avgK.result.toFixed(digits));
  fs.appendFileSync(this.fd,
    candle.start + ';' +
    candle.open.toFixed(digits) + ';' +
    candle.high.toFixed(digits) + ';' +
    candle.low.toFixed(digits) + ';' +
    candle.close.toFixed(digits) + ';' +
    this.SO.rsi.result.toFixed(digits) + ';' +
    this.SO.k.toFixed(digits) + ';' +
    this.SO.result.toFixed(digits) + ';' +
    this.SO.d.result.toFixed(digits) + "\n",
    'utf8');*/
  /*
  //BB
  log.debug('BB.lower: ', BB.lower.toFixed(digits));
  log.debug('BB.middle: ', BB.middle.toFixed(digits));
  log.debug('BB.upper: ', BB.upper.toFixed(digits));
  //candle
  log.debug('candle.high: ', candle.high.toFixed(digits));
  log.debug('candle.open: ', candle.open.toFixed(digits));
  log.debug('candle.low: ', candle.low.toFixed(digits));
  log.debug('candle.close: ', candle.close.toFixed(digits));
*/
}

method.check = function(candle) {
  /*var digits = 8;
  //StochRSI 0-100
  var half = 50;
  log.debug('weights: ', this.weights);
  //get StochRSIHistory last X element _.size(weights)
  var stochrsis = this.StochRSIhistory.slice(0-(_.size(this.weights)+1));
  log.debug('Last X StochRSI: ', stochrsis);
  var d = stochrsis.pop();
  log.debug('-----Last X StochRSI: ', stochrsis);
  log.debug('D: ', d);
  log.debug('D weight: ', this.dweight);
  //BB
  var BB = this.indicators.bb;
  //BB.lower; BB.upper; BB.middle are your line values
  var price = candle.close;
  //buy when stochRSI in low and MACD in up
  //short->sell, long->buy

  if(this.settings.thresholds.high<this.stochRSI) {
    // new trend detected
    if(this.trend.direction !== 'high')
      this.trend = {
        duration: 0,
        persisted: false,
        direction: 'high',
        adviced: false
      };
    this.trend.duration++;

    var counter = 0.0;
    for (let i=0;i<_.size(this.weights);i++){
      counter += stochrsis[i] * (1+this.weights[i]);
    }
    var mean = counter / _.size(this.weights);
    var Dcalc = d * (1+this.dweight);

    log.debug('mean: ', mean);
    log.debug('RSISELL persistence: ', this.trend.duration);
    log.debug('Current SRSI: ', this.stochRSI);
    log.debug('Last SRSI ?=^: ', this.StochRSIhistory.slice(-1)[0]);
    log.debug('Prev SRSI: ',this.StochRSIhistory.slice(-2)[0]);

    if(Dcalc<mean && !this.trend.adviced){
      this.trend.adviced = true;
      this.prevCandle.close = candle.close;
      this.prevCandle.buyevent = -1;
      this.advice('short');
      log.debug('###SELL###: ', price.toFixed(digits));
    } else
      this.advice();
  }
  //buy when stochRSI in high and BB low
  if(this.settings.thresholds.low>this.stochRSI) {
    // new trend detected
    if(this.trend.direction !== 'low')
      this.trend = {
        duration: 0,
        persisted: false,
        direction: 'low',
        adviced: false
      };
    this.trend.duration++;
    var counter = 0.0;
    for (let i=0;i<_.size(this.weights);i++){
      counter += stochrsis[i] * (1-this.weights[i]);
    }
    var mean = counter / _.size(this.weights);
    var Dcalc = d * (1-this.dweight);

    log.debug('mean: ', mean);
    log.debug('RSIBUY persistence: ', this.trend.duration);
    log.debug('Current SRSI: ', this.stochRSI);
    log.debug('Last SRSI ?=^: ', this.StochRSIhistory.slice(-1)[0]);
    log.debug('Prev SRSI: ',this.StochRSIhistory.slice(-2)[0]);

    if(Dcalc>mean && !this.trend.adviced){
      this.trend.adviced = true;
      this.prevCandle.close = candle.close;
      this.prevCandle.buyevent = 1;
      this.advice('long');
      log.debug('###BUY###: ', price.toFixed(digits));
    } else
      this.advice();
  } else {
    // trends must be on consecutive candles
    this.selltrend.duration = 0;
    this.selltrend.persisted = false;
    this.selltrend.adviced = false;
    this.trend.duration = 0;
    log.debug('In no trend');
    this.advice();
  }*/
}

module.exports = method;

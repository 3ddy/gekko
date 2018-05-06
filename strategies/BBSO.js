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
  //Size
  this.size = {
    rsi: this.settings.fstochrsi.interval,
    stoch: this.settings.fstochrsi.stoch,
    k: this.settings.fstochrsi.k,
    d: this.settings.fstochrsi.d
  };
  this.digits = 8;
  //Aggregated Indicator variables
  //Aggregated previous close, every N th candle close
  this.aggPrevClose = null;
  //Average gain/loss of aggregated candles
  this.aggAvgLoss = [];
  this.aggAvgGain = [];
  //Previous moving averages of aggregated candles
  this.aggPrevAvg = {
    gain: null,
    loss: null,
    k: null,
    d: null
  };
  //Moving Stochastic RSI, every N th is equal to this.aggPrevAvg.[k,d]
  this.aggStochRSI = {
    k: null,
    d: null
  };
  //Aggregated RSI history
  this.aggRSIHistory = [];
  //Aggregated Stochastic %K
  this.aggAvgK = [];
  //Aggregated Stochastic %D
  this.aggAvgD = [];

  //Storing prev StochRSI %D for aggragated and for original
  this.prevD = {
    a: [],
    b: []
  };

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

  try {
    fs.unlinkSync('candles.txt');
  } catch (e) {

  }
  this.fd = fs.openSync('candles.txt','a');
  fs.appendFileSync(this.fd,
    "start;open;high;low;close;rsi;k;avgK;avgD;5minclose;5minavgK;5minavgD;movingK;movingD\n",
    'utf8');
}

// what happens on every new candle?
method.update = function(candle) {
  //TODO: candle aggregating
  /**
   * only candle.close is needed
   * this.settings.fstochrsi.interval - 1 * this.settings.candles for avgLoss/Gain
   */
  //log.debug('candle',candle);
  log.debug('**** age ****',this.age);

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
    this.aggPrevClose = candle.close;
    //Calculating RS and RSI with Wilder's smoothing average
    if (this.aggAvgGain.length > this.size.rsi) {
      this.aggAvgGain.shift();
      this.aggAvgLoss.shift();
      var rs = 0;
      var rsi = 0;
      //First RSI calculation
      if (this.aggPrevAvg.gain === null) {
        this.aggPrevAvg.gain = this.aggAvgGain.reduce((sum, p) => sum + p, 0) / _.size(this.aggAvgGain);
        this.aggPrevAvg.loss = this.aggAvgLoss.reduce((sum, p) => sum + p, 0) / _.size(this.aggAvgLoss);
        rs = this.aggPrevAvg.gain / this.aggPrevAvg.loss;
      } else {
        this.aggPrevAvg.gain = (this.aggPrevAvg.gain * (this.size.rsi - 1) + this.aggAvgGain.slice(-1)[0]) / this.size.rsi;
        this.aggPrevAvg.loss = (this.aggPrevAvg.loss * (this.size.rsi - 1) + this.aggAvgLoss.slice(-1)[0]) / this.size.rsi;
        rs = this.aggPrevAvg.gain / this.aggPrevAvg.loss;
      }
      rsi = 100 - 100 / (1 + rs);
      //RSI=100 if average loss is 0 by definition
      if (this.aggPrevAvg.loss === 0 && this.aggPrevAvg.gain !== 0) {
        rsi = 100;
      } else if (this.aggPrevAvg.loss === 0) {
        rsi = 0;
      }
      this.aggRSIHistory.push(rsi);
      //Calculating Full StochascticRSI with exponential moving average
      if (this.aggRSIHistory.length > this.size.stoch) {
        this.aggRSIHistory.shift();
        var min = _.min(this.aggRSIHistory);
        var max = _.max(this.aggRSIHistory);
        this.aggAvgK.push(
          (rsi - min) / (max - min) * 100
        );
        if (this.aggAvgK.length > this.size.k) {
          this.aggAvgK.shift();
          //First %K calculation
          if (this.aggPrevAvg.k === null) {
            this.aggPrevAvg.k = this.aggAvgK.reduce((sum, p) => sum + p, 0) / _.size(this.aggAvgK);
          } else {
            //N = number of days in EMA, k = 2 / (N+1)
            var k = 2 / (this.size.k + 1);
            //EMA = Value(t) * k + EMA(t-1) * (1 – k)
            this.aggPrevAvg.k = this.aggAvgK.slice(-1)[0] * k + this.aggPrevAvg.k * (1 - k);
          }
          this.aggAvgD.push(this.aggPrevAvg.k);
          if (this.aggAvgD.length > this.size.d) {
            this.aggAvgD.shift();
            //First %D calculation
            if (this.aggPrevAvg.d === null) {
              this.aggPrevAvg.d = this.aggAvgK.reduce((sum, p) => sum + p, 0) / _.size(this.aggAvgD);
            } else {
              //N = number of days in EMA, k = 2 / (N+1)
              var k = 2 / (this.size.d + 1);
              //EMA = Value(t) * k + EMA(t-1) * (1 – k)
              this.aggPrevAvg.d = this.aggAvgD.slice(-1)[0] * k + this.aggPrevAvg.d * (1 - k);
              log.debug('candle.close', candle.close.toFixed(this.digits));
              log.debug('rsi', rsi.toFixed(this.digits));
              log.debug('this.aggPrevAvg.k', this.aggPrevAvg.k.toFixed(this.digits));
              log.debug('this.aggPrevAvg.d', this.aggPrevAvg.d.toFixed(this.digits));
              log.debug("aggStochRSI.k: " + this.aggStochRSI.k.toFixed(this.digits));
              log.debug("aggStochRSI.d: " + this.aggStochRSI.d.toFixed(this.digits));
            }
            //Saving current %K and %D
            this.aggStochRSI.k = this.aggPrevAvg.k;
            this.aggStochRSI.d = this.aggPrevAvg.d;

          }
        }
      }
    }
  } else if (_.size(this.aggAvgD) == this.size.d && this.aggPrevAvg.d !== null) {
    //Aggregated Stochastic RSI %D is full
    var gain = 0;
    var loss = 0;
    if (candle.close > this.aggPrevClose) {
      gain = candle.close - this.aggPrevClose;
      loss = 0;
    } else {
      loss = this.aggPrevClose - candle.close;
      gain = 0;
    }
    gain = (this.aggPrevAvg.gain * (this.size.rsi - 1) + gain) / this.size.rsi;
    loss = (this.aggPrevAvg.loss * (this.size.rsi - 1) + loss) / this.size.rsi;
    var rs = gain / loss;
    var rsi = 100 - 100 / (1 + rs);
    //RSI=100 if average loss is 0 by definition
    if (loss === 0 && gain !== 0) {
      rsi = 100;
    } else if (loss === 0) {
      rsi = 0;
    }
    var rsihist = _.last(this.aggRSIHistory,this.size.rsi - 1).concat(rsi);
    var min = _.min(rsihist);
    var max = _.max(rsihist);
    var stochrsi = (rsi - min) / (max - min) * 100;
    var k = 2 / (this.size.k + 1);
    //Saving current %K and %D
    this.aggStochRSI.k = stochrsi * k + this.aggPrevAvg.k * (1 - k);
    k = 2 / (this.size.d + 1);
    this.aggStochRSI.d = this.aggStochRSI.k * k + this.aggPrevAvg.d * (1 - k);
    log.debug('---- Moving ----');
    log.debug('candle.close', candle.close.toFixed(this.digits));
    log.debug('rsi', rsi.toFixed(this.digits));
    log.debug('this.aggPrevAvg.k', this.aggPrevAvg.k.toFixed(this.digits));
    log.debug('this.aggPrevAvg.d', this.aggPrevAvg.d.toFixed(this.digits));
    log.debug("aggStochRSI.k: " + this.aggStochRSI.k.toFixed(this.digits));
    log.debug("aggStochRSI.d: " + this.aggStochRSI.d.toFixed(this.digits));
  }
}

// for debugging purposes log the last
// calculated parameters.
method.log = function(candle) {
  var BB = this.indicators.bb;
  var SO = this.indicators.so;
  //BB.lower; BB.upper; BB.middle are your line values
  //SO.d.result SO.k (fast %K) SO.result = SO.avgK.result (full %K)

  /*log.debug('SO.d: ', SO.d.result.toFixed(this.digits));
  log.debug("SO.k: " + SO.k.toFixed(this.digits));
  log.debug("SO.result: " + SO.result.toFixed(this.digits));
  log.debug("SO.avgK.result: " + SO.avgK.result.toFixed(this.digits));*/
  var k = this.aggPrevAvg.k===null?0:this.aggPrevAvg.k;
  var d = this.aggPrevAvg.d===null?0:this.aggPrevAvg.d;
  var mk = this.aggStochRSI.k===null?0:this.aggStochRSI.k;
  var md = this.aggStochRSI.d===null?0:this.aggStochRSI.d;
  fs.appendFileSync(this.fd,
    candle.start + ';' +
    candle.open.toFixed(this.digits).replace(".", ",") + ';' +
    candle.high.toFixed(this.digits).replace(".", ",") + ';' +
    candle.low.toFixed(this.digits).replace(".", ",") + ';' +
    candle.close.toFixed(this.digits).replace(".", ",") + ';' +
    SO.rsi.result.toFixed(this.digits).replace(".", ",") + ';' +
    SO.k.toFixed(this.digits).replace(".", ",") + ';' +
    SO.result.toFixed(this.digits).replace(".", ",") + ';' +
    SO.d.result.toFixed(this.digits).replace(".", ",") + ';' +
    this.aggPrevClose.toFixed(this.digits).replace(".", ",") + ';' +
    k.toFixed(this.digits).replace(".", ",") + ';' +
    d.toFixed(this.digits).replace(".", ",") + ';' +
    mk.toFixed(this.digits).replace(".", ",") + ';' +
    md.toFixed(this.digits).replace(".", ",") + "\n",
    'utf8');
  /*
  //BB
  log.debug('BB.lower: ', BB.lower.toFixed(this.digits));
  log.debug('BB.middle: ', BB.middle.toFixed(this.digits));
  log.debug('BB.upper: ', BB.upper.toFixed(this.digits));
  //candle
  log.debug('candle.high: ', candle.high.toFixed(this.digits));
  log.debug('candle.open: ', candle.open.toFixed(this.digits));
  log.debug('candle.low: ', candle.low.toFixed(this.digits));
  log.debug('candle.close: ', candle.close.toFixed(this.digits));
*/
}

method.check = function(candle) {
  var SO = this.indicators.so;

  this.prevD.a.push(SO.d.result.toFixed(this.digits));
  this.prevD.b.push(this.aggStochRSI.d===null?0:this.aggStochRSI.d.toFixed(this.digits));
  if (_.size(this.prevD.a) > 3) {
    this.prevD.a.shift();
    this.prevD.b.shift();
    log.debug('prevD.a',this.prevD.a);
    log.debug('prevD.b',this.prevD.b);
    var absa = Math.abs(this.prevD.a[0] - this.prevD.a[1]).toFixed(this.digits);
    var absb = Math.abs(this.prevD.b[0] - this.prevD.b[1]).toFixed(this.digits);

    if (this.prevD.b[2] > this.settings.up){
      var anext = null;
      var bnext = null;
      if ((Number.parseFloat(this.prevD.a[1]) + Number.parseFloat(absa))>100) {
        anext = 95;
      } else {
        anext = Number.parseFloat(this.prevD.a[1]) + Number.parseFloat(absa);
      }
      if ((Number.parseFloat(this.prevD.b[1]) + Number.parseFloat(absb))>100) {
        bnext = 95;
      } else {
        bnext = Number.parseFloat(this.prevD.b[1]) + Number.parseFloat(absb);
      }
      log.debug('absa: ',absa);
      log.debug('absb: ',absb);
      log.debug('anext: ',anext);
      log.debug('areal: ',this.prevD.a[2]);
      log.debug('bnext: ',bnext);
      log.debug('breal: ',this.prevD.b[2]);
      //if (isNaN(anext) || isNaN(bnext)) exit();
      if (anext*this.settings.dev > this.prevD.a[2] && bnext*this.settings.dev > this.prevD.b[2]) {
        this.advice('short');
        log.debug('+++ ELAD +++');
        log.debug('anext: ',anext);
        log.debug('areal: ',this.prevD.a[2]);
        log.debug('bnext: ',bnext);
        log.debug('breal: ',this.prevD.b[2]);
      }
    }
    if (this.prevD.b[2] < this.settings.down) {
      var anext = ((this.prevD.a[1] - absa)<0)?5:((this.prevD.a[1] - absa) * this.settings.dev);
      var bnext = ((this.prevD.b[1] - absb)<0)?5:((this.prevD.b[1] - absb) * this.settings.dev);
      if (anext < this.prevD.a[2] && bnext < this.prevD.b[2]) {
        this.advice('long');
        log.debug('+++ VESZ +++');
        log.debug('anext: ',anext);
        log.debug('areal: ',this.prevD.a[2]);
        log.debug('bnext: ',bnext);
        log.debug('breal: ',this.prevD.b[2]);
      }
    }



  }
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

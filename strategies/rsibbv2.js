// helpers
var _ = require('lodash');
var log = require('../core/log.js');

var RSI = require('./indicators/RSI.js');
var BB = require('./indicators/BB.js');
// let's create our own method
var method = {};

// prepare everything our method needs
method.init = function() {
  this.interval = this.settings.interval;
  this.weights = this.settings.weights;
  this.dweight = this.weights.pop()
  this.prevCandle = {
    close: 0,
    buyevent: 0 // -1 SELL 0 none or emergency sell 1 BUY
  };
  this.StochRSIhistory = [];
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

  this.requiredHistory = this.tradingAdvisor.historySize;

  // define the indicators we need
  this.addIndicator('rsi', 'RSI', { interval: this.interval });
  this.addIndicator('bb', 'BB', this.settings.bbands);
  this.RSIhistory = [];
}

// what happens on every new candle?
method.update = function(candle) {
  //Update RSI
  this.rsi = this.indicators.rsi.result;

  this.RSIhistory.push(this.rsi);

  if(_.size(this.RSIhistory) > this.interval)
    // remove oldest RSI value
    this.RSIhistory.shift();
  if(_.size(this.StochRSIhistory) > this.interval)
    // remove oldest StochRSI value
    this.StochRSIhistory.shift();

  this.lowestRSI = _.min(this.RSIhistory);
  this.highestRSI = _.max(this.RSIhistory);
  this.stochRSI = ((this.rsi - this.lowestRSI) / (this.highestRSI - this.lowestRSI)) * 100;
  this.StochRSIhistory.push(this.stochRSI);
}

// for debugging purposes log the last
// calculated parameters.
method.log = function(candle) {
  var digits = 8;
  var price = candle.close;
  var clow = candle.low;
  var chigh = candle.high;
  var cmiddle = (candle.close+candle.open)/2;

  //BB
  var BB = this.indicators.bb;
  //BB.lower; BB.upper; BB.middle are your line values

  var StochRSIsaysBUY = (this.stochRSI<this.settings.thresholds.low)?true:false;
  var StochRSIsaysSELL = (this.stochRSI>=this.settings.thresholds.high)?true:false;

  var BBsayBUY=(candle.low<=BB.lower)?true:false;
  var BBsaySELL=(candle.high>=BB.upper)?true:false;

  //StochRSI
  log.debug('rsi.value: ', this.rsi.toFixed(digits));
  log.debug("StochRSI.min: " + this.lowestRSI.toFixed(digits));
  log.debug("StochRSI.max: " + this.highestRSI.toFixed(digits));
  log.debug("StochRSI.Value: " + this.stochRSI.toFixed(2));
  //BB
  log.debug('BB.lower: ', BB.lower.toFixed(digits));
  log.debug('BB.middle: ', BB.middle.toFixed(digits));
  log.debug('BB.upper: ', BB.upper.toFixed(digits));
  //candle
  log.debug('candle.high: ', candle.high.toFixed(digits));
  log.debug('candle.open: ', candle.open.toFixed(digits));
  log.debug('candle.middle: ', cmiddle.toFixed(digits));
  log.debug('candle.low: ', clow.toFixed(digits));
  log.debug('candle.close: ', price.toFixed(digits));

}

method.check = function(candle) {
  var digits = 8;
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
  }
}

module.exports = method;
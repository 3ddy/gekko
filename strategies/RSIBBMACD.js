// helpers
var _ = require('lodash');
var log = require('../core/log.js');

var RSI = require('./indicators/RSI.js');
var BB = require('./indicators/BB.js');
var MACD = require('./indicators/MACD.js');
// let's create our own method
var method = {};

// prepare everything our method needs
method.init = function() {
  this.interval = this.settings.interval;
  this.lastBuy = {
    price: 0,
    buyevent: false
  };
  this.trend = {
    direction: 'none',
    duration: 0,
    persisted: false,
    adviced: false
  };

  this.requiredHistory = this.tradingAdvisor.historySize;

  // define the indicators we need
  this.addIndicator('rsi', 'RSI', { interval: this.interval });
  this.addIndicator('macd', 'MACD', this.settings);
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

  this.lowestRSI = _.min(this.RSIhistory);
  this.highestRSI = _.max(this.RSIhistory);
  this.stochRSI = ((this.rsi - this.lowestRSI) / (this.highestRSI - this.lowestRSI)) * 100;
}

// for debugging purposes log the last
// calculated parameters.
method.log = function(candle) {
  var digits = 8;
  var price = candle.close;
  var clow = candle.low;
  var cmiddle = (candle.close+candle.open)/2;

  //MACD
  var macd = this.indicators.macd;
  var diff = macd.diff;
  var signal = macd.signal.result;
  var macddiff = this.indicators.macd.result;
  var isSignalNegative = signal<0?true:false;
  var isMacddiffNegative = macddiff<0?true:false;

  //BB
  var BB = this.indicators.bb;
  //BB.lower; BB.upper; BB.middle are your line values

  var StochRSIsaysBUY = this.stochRSI < this.settings.thresholds.low;
  var StochRSIsaysSELL = this.stochRSI >= this.settings.thresholds.high;
  var BBsayBUY=Math.abs(clow-BB.lower)<this.settings.lower_distance;
  var BBsaySELL=cmiddle>BB.upper;
  var MACDsaysBUY = (isSignalNegative !== isMacddiffNegative)?true:false;
  var MACDsaysSELL = (isSignalNegative !== isMacddiffNegative)?true:false;

  //StochRSI
  log.debug('rsi.value: ', this.rsi.toFixed(digits));
  log.debug("StochRSI.min: " + this.lowestRSI.toFixed(digits));
  log.debug("StochRSI.max: " + this.highestRSI.toFixed(digits));
  log.debug("StochRSI.Value: " + this.stochRSI.toFixed(2));
  //MACD
  log.debug('macd.short:', macd.short.result.toFixed(digits));
  log.debug('macd.long:', macd.long.result.toFixed(digits));
  log.debug('macd.macd:', diff.toFixed(digits));
  log.debug('macd.signal:', signal.toFixed(digits));
  log.debug('macd.macdiff:', macd.result.toFixed(digits));
  //BB
  log.debug('BB.lower:', BB.lower.toFixed(digits));
  log.debug('BB.middle:', BB.middle.toFixed(digits));
  log.debug('BB.upper:', BB.upper.toFixed(digits));
  //candle
  log.debug('candle.high:', candle.high.toFixed(digits));
  log.debug('candle.open:', candle.open.toFixed(digits));
  log.debug('candle.middle:', cmiddle.toFixed(digits));
  log.debug('candle.low:', clow.toFixed(digits));
  log.debug('candle.close:', price.toFixed(digits));
  if(BBsayBUY) log.debug('BBsayBUY');
  if(BBsaySELL) log.debug('BBsaySELL');
  if(StochRSIsaysSELL) log.debug('StochRSIsaysSELL');
  if(StochRSIsaysBUY) log.debug('StochRSIsaysBUY');
}

method.check = function(candle) {
  //MACD
  //+ EMAshort>EMAlong # - EMAshort<EMAlong
  var macd = this.indicators.macd;
  var signal = macd.signal.result;
  var macddiff = this.indicators.macd.result;
  var isSignalNegative = signal<0?true:false;
  var isMacddiffNegative = macddiff<0?true:false;
  //BB
  var BB = this.indicators.bb;
  //BB.lower; BB.upper; BB.middle are your line values
  var price = candle.close;
  var clow = candle.low;
  var cmiddle = (candle.close+candle.open)/2;
  //buy when stochRSI in low and MACD in up
  //short->sell, long->buy

/*
  var MACDsaysBUY = macddiff > this.settings.thresholds.up;
  var MACDsaysSELL = macddiff <= this.settings.thresholds.down;
  var StochRSIsaysBUY = this.stochRSI < this.settings.thresholds.low;
  var StochRSIsaysSELL = this.stochRSI >= this.settings.thresholds.high;
  var BBsayBUY=price >= (BB.middle-(BB.middle-BB.lower)/4);
  var BBsaySELL=price <= BB.lower; //>= BB.upper || price <= BB.lower
*/
  var StochRSIsaysBUY = this.stochRSI < this.settings.thresholds.low;
  var StochRSIsaysSELL = this.stochRSI >= this.settings.thresholds.high;
  var BBsayBUY=Math.abs(clow-BB.lower)<this.settings.lower_distance;
  var BBsaySELL=candle.high>BB.upper;
  var MACDsaysBUY = (isSignalNegative !== isMacddiffNegative)?true:false;
  var MACDsaysSELL = (isSignalNegative !== isMacddiffNegative)?true:false;

  if(BBsaySELL && StochRSIsaysSELL) {
    // new trend detected
    if(this.trend.direction !== 'high')
      this.trend = {
        duration: 0,
        persisted: false,
        direction: 'high',
        adviced: false
      };
    this.trend.duration++;

    log.debug('In high since', this.trend.duration, 'candle(s)');

    if(this.trend.duration >= this.settings.thresholds.persistence )
      this.trend.persisted = true;

    if(this.trend.persisted && !this.trend.adviced) {
      this.trend.adviced = true;
      this.advice('short');
      this.lastBuy.price = 0;
      this.lastBuy.buyevent = false;
      log.debug('###SELL###: ', price.toFixed(8));
    } else
      this.advice();
  }
  //buy when stochRSI in high and MACD in low
  else if(StochRSIsaysBUY && BBsayBUY) {
    // new trend detected
    if(this.trend.direction !== 'low')
      this.trend = {
        duration: 0,
        persisted: false,
        direction: 'low',
        adviced: false
      };
    this.trend.duration++;

    log.debug('In low since', this.trend.duration, 'candle(s)');

    if(this.trend.duration >= this.settings.thresholds.persistence)
      this.trend.persisted = true;

    if(this.trend.persisted && !this.trend.adviced) {
      this.trend.adviced = true;
      this.lastBuy.price = candle.close;
      this.lastBuy.buyevent = true;
      this.advice('long');
      log.debug('###BUY###: ', price.toFixed(8));
    } else
      this.advice();

  }
  //sell if price drops
  else if(price < this.lastBuy.price*this.settings.sellpercent && this.lastBuy.buyevent) {
    log.debug('Price is lower then last buy price.\nprice: ', price,
      '\nlastBuyPrice: ', this.lastBuy.price,
      '\ncalculated threshold:', price*this.settings.sellpercent,'\n');
    this.advice('short');
    this.lastBuy.buyevent = false;
    this.lastBuy.price = 0;
  } else {
    // trends must be on consecutive candles
    this.trend.duration = 0;
    log.debug('In no trend');
    this.advice();
  }
}

module.exports = method;
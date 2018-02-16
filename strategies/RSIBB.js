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
  this.lastBuy = {
    price: 0,
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
  var chigh = candle.high;
  var cmiddle = (candle.close+candle.open)/2;

  //BB
  var BB = this.indicators.bb;
  var s_bb_up = BB.middle+BB.middle*this.settings.s_up;
  var s_bb_dn = BB.middle-BB.middle*this.settings.s_dn;
  //BB.lower; BB.upper; BB.middle are your line values

  var StochRSIsaysBUY = (this.stochRSI<this.settings.thresholds.low)?true:false;
  var StochRSIsaysSELL = (this.stochRSI>=this.settings.thresholds.high)?true:false;
  var SecondRSIBUY = (this.stochRSI<=this.settings.thresholds.s_low)?true:false;
  var SecondRSISELL = (this.stochRSI>=this.settings.thresholds.s_high)?true:false;
//  var BBsayBUY=Math.abs(clow-BB.lower)<this.settings.lower_distance;
  var BBsayBUY=(candle.low<=BB.lower)?true:false;
  var BBsaySELL=(candle.high>=BB.upper)?true:false;
  var inMiddleZone = (cmiddle <= s_bb_up && cmiddle >= s_bb_dn)?true:false;

  //StochRSI
  log.debug('rsi.value: ', this.rsi.toFixed(digits));
  log.debug("StochRSI.min: " + this.lowestRSI.toFixed(digits));
  log.debug("StochRSI.max: " + this.highestRSI.toFixed(digits));
  log.debug("StochRSI.Value: " + this.stochRSI.toFixed(2));
  //BB
  log.debug('BB.lower: ', BB.lower.toFixed(digits));
  log.debug('BB.middle: ', BB.middle.toFixed(digits));
  log.debug('BB.upper: ', BB.upper.toFixed(digits));
  log.debug('BB.middle.up: ', s_bb_up.toFixed(digits));
  log.debug('BB.middle.dn: ', s_bb_dn.toFixed(digits));
  //candle
  log.debug('candle.high: ', candle.high.toFixed(digits));
  log.debug('candle.open: ', candle.open.toFixed(digits));
  log.debug('candle.middle: ', cmiddle.toFixed(digits));
  log.debug('candle.low: ', clow.toFixed(digits));
  log.debug('candle.close: ', price.toFixed(digits));
  //conditions
  if(BBsayBUY) log.debug('BBsayBUY');
  if(BBsaySELL) log.debug('BBsaySELL');
  if(inMiddleZone) log.debug('inMiddleZone');
  if(StochRSIsaysSELL) log.debug('StochRSIsaysSELL');
  if(StochRSIsaysBUY) log.debug('StochRSIsaysBUY');
  if(SecondRSIBUY) log.debug('SecondRSIBUY');
  if(SecondRSISELL) log.debug('SecondRSISELL');
}

method.check = function(candle) {
  var digits = 8;
  //BB
  var BB = this.indicators.bb;
  //BB.lower; BB.upper; BB.middle are your line values
  var price = candle.close;
  var clow = candle.low;
  var chigh = candle.high;
  var cmiddle = (candle.close+candle.open)/2;
  var s_bb_up = BB.middle+BB.middle*this.settings.s_up;
  var s_bb_dn = BB.middle-BB.middle*this.settings.s_dn;
  //buy when stochRSI in low and MACD in up
  //short->sell, long->buy

  var StochRSIsaysBUY = (this.stochRSI<=this.settings.thresholds.low)?true:false;
  var StochRSIsaysSELL = (this.stochRSI>=this.settings.thresholds.high)?true:false;
  var SecondRSIBUY = (this.stochRSI<=this.settings.thresholds.s_low)?true:false;
  var SecondRSISELL = (this.stochRSI>=this.settings.thresholds.s_high)?true:false;
//  var BBsayBUY=Math.abs(clow-BB.lower)<this.settings.lower_distance;
  var BBsayBUY = (candle.low<=BB.lower)?true:false;
  var BBsaySELL = (candle.high>=BB.upper)?true:false;
  var inMiddleZone = (cmiddle <= s_bb_up && cmiddle >= s_bb_dn)?true:false;

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

    log.debug('BBSELL && RSISELL persistence: ', this.trend.duration);

    if(this.trend.duration >= this.settings.thresholds.persistence )
      this.trend.persisted = true;

    if(this.trend.persisted && !this.trend.adviced) {
      this.trend.adviced = true;
      this.advice('short');
      this.lastBuy.price = 0;
      this.lastBuy.buyevent = -1;
      log.debug('###SELL###: ', price.toFixed(digits));
    } else
      this.advice();
  }
  //buy when stochRSI in high and BB low
  else if(BBsayBUY && StochRSIsaysBUY) {
    // new trend detected
    if(this.trend.direction !== 'low')
      this.trend = {
        duration: 0,
        persisted: false,
        direction: 'low',
        adviced: false
      };
    this.trend.duration++;

    log.debug('BBBUY && RSIBUY persistence: ', this.trend.duration);

    if(this.trend.duration >= this.settings.thresholds.persistence)
      this.trend.persisted = true;

    if(this.trend.persisted && !this.trend.adviced) {
      this.trend.adviced = true;
      this.lastBuy.price = candle.close;
      this.lastBuy.buyevent = 1;
      this.advice('long');
      log.debug('###BUY###: ', price.toFixed(digits));
    } else
      this.advice();
  }
  //after buy 
  //Second trend sell?
  else if(this.lastBuy.buyevent === 1) {
    //Second SRSI is high cmiddle is in BB.middle zone
    if (SecondRSISELL && inMiddleZone){
    //Second trend persistence
      if(this.strend.direction !== 'high')
        this.strend = {
          duration: 0,
          persisted: false,
          direction: 'high',
          adviced: false
        };
      this.strend.duration++;

      log.debug('SecondRSISELL && inMiddleZone persistence: ', this.strend.duration);

      if(this.strend.duration >= this.settings.thresholds.s_persistence ) {
        this.strend.persisted = true;
      }
      if(this.strend.persisted && !this.strend.adviced) {
        this.strend.adviced = true;
        this.advice('short');
        this.lastBuy.price = 0;
        this.lastBuy.buyevent = -1;
        log.debug('###S_SELL###: ', price.toFixed(digits));
      }
    }
    //Emergency sell
    else if (price < this.lastBuy.price*this.settings.sellpercent) {
      this.selltrend.duration++;
      log.debug('price: ', price.toFixed(digits));
      log.debug('lastBuyPrice: ', this.lastBuy.price.toFixed(digits));
      log.debug('calculated threshold: ', price*this.settings.sellpercent);
      log.debug('selltrend.duration: ', this.selltrend.duration);
      if (this.selltrend.duration >= this.settings.sellpersistence) {
        this.selltrend.persisted = true;
      }
      if (this.selltrend.persisted && !this.selltrend.adviced) {
        log.debug('###E_SELL###: ', price.toFixed(digits));
        this.selltrend.adviced = true;
        this.advice('short');
        this.lastBuy.buyevent = 0;
        this.lastBuy.price = 0;
      }
    } else {
      //reset and wait
      this.selltrend.duration = 0;
      this.selltrend.persisted = false;
      this.selltrend.adviced = false;
      this.strend.duration = 0;
      this.advice();
    }
  }
  //after sell
  else if (this.lastBuy.buyevent === -1) {
    //Second SRSI is high cmiddle is in BB.middle zone
    if (SecondRSIBUY && inMiddleZone){
    //Second trend persistence
      if(this.strend.direction !== 'low')
        this.strend = {
          duration: 0,
          persisted: false,
          direction: 'low',
          adviced: false
        };
      this.strend.duration++;

      log.debug('SecondRSIBUY && inMiddleZone persistence: ', this.strend.duration);

      if(this.strend.duration >= this.settings.thresholds.s_persistence ) {
        this.strend.persisted = true;
      }
      if(this.strend.persisted && !this.strend.adviced) {
        this.strend.adviced = true;
        this.advice('long');
        this.lastBuy.price = candle.close;
        this.lastBuy.buyevent = 1;
        log.debug('###S_BUY###: ', price.toFixed(digits));
      }
    } else {
      //reset and wait
      this.strend.duration = 0;
      this.advice();
    }
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
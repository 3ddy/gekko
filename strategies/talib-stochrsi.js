// If you want to use your own trading methods you can
// write them here. For more information on everything you
// can use please refer to this document:
//
// https://github.com/askmike/gekko/blob/stable/docs/trading_methods.md

// Let's create our own method
var method = {};

// Prepare everything our method needs
method.init = function() {
  this.name = 'talib-stochrsi'
  this.input = 'candle';
  // keep state about the current trend
  // here, on every new candle we use this
  // state object to check if we need to
  // report it.
  this.trend = 'none';

  // how many candles do we need as a base
  // before we can start giving advice?
  this.requiredHistory = this.tradingAdvisor.historySize;

  // define the indicators we need
  this.addTalibIndicator('mystochrsi', 'stochrsi', { optInTimePeriod:14, optInFastK_Period=3, optInFastD_Period=3, optInFastD_MAType=0 });
}

// What happens on every new candle?
method.update = function(candle) {
  // nothing!
}


method.log = function(candle) {
  // nothing!
  log.debug('candle: ',candle);
  log.debug('outFastK: ',this.talibIndicators.mystochrsi.outFastK);
  log.debug('outFastD: ',this.talibIndicators.mystochrsi.outFastD);
}

// Based on the newly calculated
// information, check if we should
// update or not.
method.check = function(candle) {
  this.advice();
}

module.exports = method;

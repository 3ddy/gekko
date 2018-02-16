// required indicators
//Full Stochastic Oscillator based on RSI
var EMA = require('./EMA');
var RSI = require('./RSI');
var _ = require('lodash');
var log = require('../../core/log');

var Indicator = function (settings) {
  this.input = 'candle';
  //log.debug("--------settings: ",settings);
  //Number of %K
  this.ksize = settings.k;
  //log.debug("--------settings: ",this.ksize);
  //Number of %D
  this.dsize = settings.d;
  //log.debug("--------settings: ",this.dsize);
  //Number of rsi for MIN and MAX
  this.weight = settings.stoch;
  //log.debug("--------settings: ",this.weight);
  this.interval = settings.interval;
  //average fast %K for full stochastic EMA(fast %K)
  this.avgK = new EMA(this.ksize);
  //fast (current) %K
  this.k = 0;
  //%D=(EMA(%K))
  this.d = new EMA(this.dsize);
  //rsi
  this.rsi = new RSI(settings);
  this.RSIhistory = [];
  this.age = 0;
  this.result = 0;
}

Indicator.prototype.update = function(candle) {
  this.rsi.update(candle);
  var currentRSI = this.rsi.result;
  if(this.age < this.interval) {
    //Waiting for the history fill up
    //log.debug("--------SO return: ",this.age);
    this.age++;
    return;
  }
  this.RSIhistory.push(currentRSI);
  // remove oldest RSI value
  if(_.size(this.RSIhistory) > this.weight) {
    this.RSIhistory.shift();
  }
  if(this.age < this.interval + this.weight) {
    //Waiting for the history fill up
    //log.debug("--------SO return: ",this.age);
    this.age++;
    return;
  }
  //log.debug("++++++++++++++SO calc: ",this.age);
  //log.debug("currentRSI: ",currentRSI);
  //log.debug('this.RSIhistory: ',this.RSIhistory );
  var lowrsi = _.min(this.RSIhistory);
  var highrsi = _.max(this.RSIhistory);
  /*log.debug('lowrsi: ',lowrsi);
  log.debug('highrsi: ',highrsi);*/
  //Calculate fast (current) %K
  this.k = ((currentRSI - lowrsi) / (highrsi - lowrsi)) * 100;
  //log.debug('this.k:',this.k);
  //Calculate %K
  this.avgK.update(this.k);
  if (this.age > this.interval + this.weight + this.ksize) {
    //log.debug('this.avgK: ',this.avgK);
    //log.debug('this.avgK.result: ',this.avgK.result);*/
    this.result = this.avgK.result;
    //log.debug('this.result: ',this.result);
    //Calculate %D
    this.d.update(this.result);
    //log.debug('this.d.result',this.d.result)
  }
  this.age++;
}

module.exports = Indicator;

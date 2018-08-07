// helpers
var _ = require('lodash');
var log = require('../core/log');
var fs = require('fs');

var SO = require('./indicators/SO.js');
// let's create our own method
var method = {};

/**
 *
 * @param {number} value
 * @param {array} zone
 * @returns {boolean}
 */
method.inZone = function(value,zone) {
  return value >= zone[0] && value <= zone[1];
};

/**
 * Simple Average
 * @param {array} values
 * @returns {number} float average
 */
method.calculateAverage = function(values) {
  return (values.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / values.length);
};

/**
 *
 * @param {array} candles
 * @returns {number}
 */
method.calculateAvgAll = function (candles) {
  //log.debug('candles',candles);
  let open = candles[0].open;
  //log.debug('open',open.toFixed(this.digits));
  let high = candles.reduce((max,candle) => Math.max(max, candle.high),candles[0].high);
  //log.debug('high',high.toFixed(this.digits));
  let low = candles.reduce((min,candle) => Math.min(min, candle.low),candles[0].low);
  //log.debug('low',low.toFixed(this.digits));
  let close = (candles.slice(-1)[0]).close;
  //log.debug('close',close.toFixed(this.digits));
  return ((Number.parseFloat(open) + Number.parseFloat(high) + Number.parseFloat(low) + Number.parseFloat(close)) / 4);
};

/**
 * Calculating Exponential Moving Average
 * @param {array} values
 * @param {number} lastvalue
 * @returns {number} float
 */
method.calculateEMA = function(values,lastvalue = null) {
  let result = lastvalue;
  let size = values.length;
  //N = number of days in EMA, k = 2 / (N+1)
  let k = 2 / (Number.parseInt(size) + 1);
  //EMA = Value(t) * k + EMA(t-1) * (1 – k)
  if (lastvalue === null) {
    result = this.calculateAverage(values);
  } else {
    result = Number.parseFloat(values.slice(-1)[0]) * k + Number.parseFloat(lastvalue * (1 - k));
  }
  return result;
};

/**
 * Calculating Wilder's Moving Average
 * @param {array} values
 * @param {number} lastvalue
 * @returns {number} float
 */
method.calculateWilder = function(values,lastvalue = null) {
  let result = lastvalue;
  let size = values.length;
  if (lastvalue === null) {
    result = this.calculateAverage(values);
  } else {
    result = (lastvalue * (size - 1) + Number.parseFloat(values.slice(-1)[0])) / Number.parseInt(size);
  }
  return result;
};

/**
 * Calculate RSI
 * 100-(100/(1+RS))
 * @param {number} gain
 * @param {number} loss
 * @returns {number} float rsi
 */
method.calculateRSI = function (gain = 0,loss = 0) {
  let rsi = 0;
  if (loss === 0 && gain !== 0) {
    rsi = 100;
  } else if (loss === 0) {
    rsi = 0;
  } else {
    let rs = gain / loss;
    rsi = 100 - 100 / (1.0 + Number.parseFloat(rs));
  }
  return Number.parseFloat(rsi);
};
/**
 *
 * @param {number} min
 * @param {number} max
 * @param {number} rsi
 * @returns {number} float
 */
method.calculateStochastic = function(min = 0, max = 0, rsi = 0) {
  if (min === max) {
    log.debug('min === max');
    return 0;
  } else {
    return 100 * ((rsi - min) / (max - min));
  }
};

/*
    previousValue: null,
    gains: [],
    gainWilderAvg: null,
    losses: [],
    lossWilderAvg: null,
    rsis: [],
    k: [],
    avgK: null,
    d: [],
    avgD:null
 */
/**
 *
 * @param {number} input
 * @param {number} candleId
 * @param {Object} indicatorValuesStore
 * @param {number} minute
 * @param {Object} size
 * @returns {number}
 */
method.calculateStochasticRSI = function (
  input,  //input data
  candleId, //age
  indicatorValuesStore = {},  //object for storing temporary data and results
  minute=5, //x minute average candle
  size = {rsi:14,stoch:9}
)
{
  if (indicatorValuesStore.previousValue === null) {
    indicatorValuesStore.previousValue = input;
  }
  let gain, loss, rsi, srsi = 0;
  if (input > indicatorValuesStore.previousValue) {
    gain = input - indicatorValuesStore.previousValue;
    loss = 0;
  } else {
    gain = 0;
    loss = indicatorValuesStore.previousValue - input;
  }
  //log.debug('gain',gain);
  //log.debug('loss',loss);
  //Minden X-ik elemet elmentjük
  if (candleId % minute === 0) {
    //Save X. input
    indicatorValuesStore.previousValue = input;
    //RSI start
    indicatorValuesStore.gains.push(gain);
    indicatorValuesStore.losses.push(loss);
    if (indicatorValuesStore.losses.length === size.rsi) {
      indicatorValuesStore.gainWilderAvg = this.calculateWilder(
        indicatorValuesStore.gains,
        indicatorValuesStore.gainWilderAvg);
      indicatorValuesStore.lossWilderAvg = this.calculateWilder(
        indicatorValuesStore.losses,
        indicatorValuesStore.lossWilderAvg);
      rsi = this.calculateRSI(
        indicatorValuesStore.gainWilderAvg,
        indicatorValuesStore.lossWilderAvg
      );
      indicatorValuesStore.gains.shift();
      indicatorValuesStore.losses.shift();
      //RSI end
      //Stochastic start
      indicatorValuesStore.rsis.push(rsi);
      if (indicatorValuesStore.rsis.length === size.stoch) {
        let min = _.min(indicatorValuesStore.rsis);
        let max = _.max(indicatorValuesStore.rsis);
        srsi = this.calculateStochastic(min, max, rsi);
        indicatorValuesStore.rsis.shift();
        //Stochastic end
      }
    }
  } else if (indicatorValuesStore.rsis.length === (size.stoch - 1)) {
    //log.debug('---moving---',minute);
    //log.debug('indicatorValuesStore.previousValue',indicatorValuesStore.previousValue);
    //log.debug('input',input);
    let gainavg = this.calculateWilder(
      indicatorValuesStore.gains.concat(gain),
      indicatorValuesStore.gainWilderAvg);
    let lossavg = this.calculateWilder(
      indicatorValuesStore.losses.concat(loss),
      indicatorValuesStore.lossWilderAvg);
    //log.debug('gainavg',gainavg);
    //log.debug('lossavg',lossavg);
    rsi = this.calculateRSI(gainavg,lossavg);
    //log.debug('rsi',rsi);
    let min = _.min(indicatorValuesStore.rsis.concat(rsi));
    let max = _.max(indicatorValuesStore.rsis.concat(rsi));
    //log.debug('indicatorValuesStore.rsis.concat(rsi)',indicatorValuesStore.rsis.concat(rsi));
    //log.debug('min',min);
    //log.debug('max',max);
    srsi = this.calculateStochastic(min, max, rsi);
    //log.debug('stoch',srsi);
  }
  return srsi;
};

/**
 *
 * @param {number}input
 * @param {Object} indicatorValuesStore
 * @param {string} indicator
 * @param {number} size
 * @param {number} avg
 * @returns {number}
 */
method.calculateSuper = function(input, indicatorValuesStore = {}, indicator = 'k', size = 3, avg = 1) {
  let lastvalue = null;
  let values = [];
  switch (indicator) {
    case 'k':
      lastvalue = indicatorValuesStore.avgK;
      values = indicatorValuesStore.k;
      break;
    case 'd':
      lastvalue = indicatorValuesStore.avgD;
      values = indicatorValuesStore.d;
      break;
  }
  values.push(input);
  log.debug('values', values);
  if (indicator === 'k') log.debug('indicatorValuesStore.k', indicatorValuesStore.k);
  if (indicator === 'd') log.debug('indicatorValuesStore.d', indicatorValuesStore.d);

  let ret = lastvalue;
  if (values.length === size) {
    switch (avg) {
      case 0:
        ret = this.calculateEMA(values,lastvalue);
        break;
      case 1:
        ret = this.calculateWilder(values,lastvalue);
        break;
    }
    values.shift();
  }
  return ret;
};


/**
 *
 * @param {number} prevValue
 * @param {number} value
 * @returns {number} distance
 */
method.calculateDistance = function (prevValue, value) {
  return Number.parseFloat(value) - Number.parseFloat(prevValue);
};

method.getZone = function (prevDist,dist,limit = 0,prevZone = 0) {
  let irany = 0;
  let zone = prevZone;
  /*
  Ha A + és B - ---> akkor esik a görbe, azaz DOWN
  Ha A - és B - ---> nem történik semmi, azaz DOWN
  Ha A - és B + ----> akkor nőni kezd a görbe, azaz UP
  Ha A + és B + ----> nem történik semmi, azaz UP.
 */
  if (prevDist > 0 && dist < 0) {
    irany = -1; //le
  } else if (prevDist < 0 && dist < 0) {
    irany = -1; //le
  } else if (prevDist < 0 && dist > 0) {
    irany = 1; //fel
  } else if (prevDist > 0 && dist > 0) {
    irany = 1; //fel
  }
  if (dist >= limit && irany === 1) {
    zone = 1;
  } else if (dist <= (limit * -1) && irany === -1) {
    zone = 4;
  } else if (this.inZone(dist, [0,limit]) &&
    irany === 1 && (prevZone === 1 || prevZone === 3)) {
    zone = 2;
  } else if (this.inZone(dist, [(limit * -1),0]) &&
    irany === -1 && (prevZone === 4 || prevZone === 6)) {
    zone = 5;
  }else if (this.inZone(dist, [(limit * -1),0]) &&
    irany === -1 && prevZone === 2) {
    zone = 3;
  } else if (this.inZone(dist, [0,limit]) &&
    irany === 1 && prevZone === 5){
    zone = 6;
  } else {
  }
  return zone;
};

// prepare everything our method needs
method.init = function() {
  //TODO init
  this.requiredHistory = this.tradingAdvisor.historySize;
  log.warn('this.tradingAdvisor.historySize: ', this.tradingAdvisor.historySize);
  this.addIndicator('so', 'SO', this.settings.fstochrsi);
  //Size
  this.size = {
    rsi: this.settings.fstochrsi.interval,
    stoch: this.settings.fstochrsi.stoch,
    k: this.settings.fstochrsi.k,
    d: this.settings.fstochrsi.d,
    xmin: this.settings.superk.xmin,
    avgk: this.settings.superk.avgK,
    avgd: this.settings.superk.avgD
  };
  this.digits = 8;
  this.indicatorValues = JSON.stringify({
    previousValue: null,
    gains: [],
    gainWilderAvg: null,
    losses: [],
    lossWilderAvg: null,
    rsis: [],
    k: [],
    avgK: null,
    d: [],
    avgD: null
  });
  //log.debug('INIT ---this.indicatorValues',this.indicatorValues);
  //this.oneMinuteValues = [];
  this.oneMinuteValues = JSON.parse(this.indicatorValues);
  //log.debug('INIT ---this.oneMinuteValues',this.oneMinuteValues);

  //this.fiveMinuteValues = [];
  //while (this.fiveMinuteValues.length < 5) {
    this.fiveMinuteValues = JSON.parse(this.indicatorValues);
  //}
  log.debug('INIT ---this.fiveMinuteValues',this.fiveMinuteValues.length);

  //this.xMinuteValues = [];
  //while (this.xMinuteValues.length < this.size.xmin) {
    this.xMinuteValues = JSON.parse(this.indicatorValues);
  //}
  log.debug('INIT ---this.xMinuteValues',this.xMinuteValues.length);

  this.candleStore = {
    five: [],
    xmin: []
  };
  this.currentAvgAll = {
    one:0,
    five:0,
    xmin:0
  };
  /*this.indicatorResults = {
    one: {},
    five: {},
    xmin: {}
  };*/
  this.indicatorResults = {
    one: {rsi: 0, k:0, d: 0},
    five: {rsi: 0, k:0, d: 0},
    xmin: {rsi: 0, k:0, d: 0}
  };

  this.zone = 0;
  this.distance = {
    sD5dist: 0,
    avgallD_dist: 0,
    avgallD_distdist: 0
  };

  this.age = 0;

  this.prevCandle = {
    close: 0,
    min: null, //minimum price since last sell
    max: null, //maximum price since last buy
    zone: 0, //5, 6, 1 a vételi zónák 2, 3, 4 az eladási zónák
    buyevent: 0 // -1 SELL 0 none or emergency sell 1 BUY
  };
  //Nincs művelet amíg le nem tellik
  this.timeout = this.settings.thresholds.timeout;
  let filename = 'candles3.csv';
  try {
    fs.unlinkSync(filename);
  } catch (e) {
    log.debug(e);
  }
  this.fd = fs.openSync(filename,'a');
  fs.appendFileSync(this.fd,
    "start;age;open;high;low;close;1minavgall;5minavgall;Xminavgall;1misrsi;5misrsi;Xmisrsi;5minK;5minD\n",
    'utf8');
  this.sor = '';
};

// what happens on every new candle?
method.update = function(candle) {
  //TODO update
  log.debug('update age', this.age);
  //1 perces
  this.currentAvgAll.one = this.calculateAvgAll([candle]);
  this.indicatorResults.one.rsi = this.calculateStochasticRSI(
    this.currentAvgAll.one,
    this.age,
    this.oneMinuteValues,
    1,
    this.size);

  //5 perces
  this.candleStore.five.push(candle);
  if (this.candleStore.five.length === 5) {
    this.currentAvgAll.five = this.calculateAvgAll(this.candleStore.five);
    log.debug('this.currentAvgAll.five',this.currentAvgAll.five);
    this.indicatorResults.five.rsi = this.calculateStochasticRSI(
      this.currentAvgAll.five,
      this.age,
      this.fiveMinuteValues,
      5,
      this.size);
    this.candleStore.five.shift();
  }
  this.indicatorResults.five.k = this.fiveMinuteValues.avgK = this.calculateSuper(
    this.indicatorResults.five.rsi,
    this.fiveMinuteValues,
    'k',
    this.size.k,
    1
  );
  if (!isNaN(this.fiveMinuteValues.avgK) && this.fiveMinuteValues.avgK !== null) {
    this.indicatorResults.five.d = this.fiveMinuteValues.avgD = this.calculateSuper(
      this.fiveMinuteValues.avgK,
      this.fiveMinuteValues,
      'd',
      this.size.d,
      1
    );
  }
  //X perces
  this.candleStore.xmin.push(candle);
  if (this.candleStore.xmin.length === this.size.xmin) {
    this.currentAvgAll.xmin = this.calculateAvgAll(this.candleStore.xmin);
    this.indicatorResults.xmin.rsi = this.calculateStochasticRSI(
      this.currentAvgAll.xmin,
      this.age,
      this.xMinuteValues,
      this.size.xmin,
      this.size);
    this.candleStore.xmin.shift();
  }
};

// for debugging purposes log the last
// calculated parameters.
method.log = function(candle) {
  //log.debug('log',this.age);
  let SO = this.indicators.so;

  if (this.sor !== '') {
    fs.appendFileSync(this.fd,this.sor + "\n",'utf8');
  }

  let d = new Date(candle.start);

  //    "start;age;open;high;low;close;1minavgall;5minavgall;Xminavgall;1misrsi;5misrsi;Xmisrsi\n",
  this.sor = '"' +
    d.getFullYear() + '-' + (Number.parseInt(d.getMonth())+1) + '-' +d.getDate() + ' ' +
    d.toLocaleTimeString('hu-HU') + '";' + this.age + ';' +
    candle.open.toFixed(this.digits).replace(".", ",") + ';' +
    candle.high.toFixed(this.digits).replace(".", ",") + ';' +
    candle.low.toFixed(this.digits).replace(".", ",") + ';' +
    candle.close.toFixed(this.digits).replace(".", ",") + ';' +
    this.currentAvgAll.one.toFixed(this.digits * 2).replace(".", ",") + ';' +
    this.currentAvgAll.five.toFixed(this.digits * 2).replace(".", ",") + ';' +
    this.currentAvgAll.xmin.toFixed(this.digits * 2).replace(".", ",") + ';' +
    this.indicatorResults.one.rsi.toFixed(this.digits).replace(".", ",") + ';' +
    this.indicatorResults.five.rsi.toFixed(this.digits).replace(".", ",") + ';' +
    this.indicatorResults.xmin.rsi.toFixed(this.digits).replace(".", ",") + ';' +
    this.indicatorResults.five.k.toFixed(this.digits).replace(".", ",") + ';' +
    this.indicatorResults.five.d.toFixed(this.digits).replace(".", ",") + ';';

};

method.check = function(candle) {
  let SO = this.indicators.so;
  log.debug('check',this.age);

};

module.exports = method;

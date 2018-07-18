// helpers
var _ = require('lodash');
var log = require('../core/log');
var fs = require('fs');

var SO = require('./indicators/SO.js');
// let's create our own method
var method = {};

method.inZone = function(value,zone) {
  if (value >= zone[0] && value <= zone[1]) return true;
  else return false;
}

/**
 * Simple Average
 * @param values
 * @returns {number} float average
 */
method.calculateAverage = function(values) {
  return (values.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / values.length);
}

/**
 * Calculating Exponential Moving Average
 * @param values: array
 * @param lastvalue: float or null
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
    result = Number.parseFloat(values.slice(-1)[0]) + Number.parseFloat(lastvalue * (1 - k));
  }
  return result;
}

/**
 * Calculating Wilder's Movind Average
 * @param values: array
 * @param lastvalue: float or null
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
}

/**
 * Calculate RSI
 * 100-(100/(1+RS))
 * @param gain
 * @param loss
 * @returns {number} float rsi
 */
method.calculateRSI = function (gain = 0,loss = 0) {
  let rsi;
  if (loss === 0 && gain !== 0) {
    rsi = 100;
  } else if (loss === 0) {
    rsi = 0;
  } else {
    let rs = gain / loss;
    rsi = 100 - 100 / (1 + Number.parseFloat(rs));
  }
  return Number.parseFloat(rsi);
}
/**
 *
 * @param min
 * @param max
 * @param rsi
 * @returns {number} float
 */
method.calculateStochastic = function(min = 0, max = 0, rsi = 0) {
  if (min === max) {
    return 0;
  } else {
    return ((rsi - min) / (max - min)) * 100;
  }
}

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
 * @param input float Amiből számolunk StochRSI-t
 * @param candleId int Hányadik percben járunk
 * @param indicatorValuesStore
 * @param minute int hány perces átlagot akarunk
 * @param offset int eltolás ha többet akarunk számolni
 * @param avg int EMA vagy Wilder //TODO nincs kész
 */
method.calculateXMinuteMovingIndicator = function (
  input,  //input data
  candleId, //age
  indicatorValuesStore = [null],  //object for storing temporary data and results
  minute=5, //x minute average candle
  offset=0,  //if we one multiple X minutes value (0 <-> minute-1)
  avg = 0   //0 = EMA 1 = Wilder
) {
  log.debug('input',input);
  log.debug('candleId',candleId);
  log.debug('indicatorValuesStore',indicatorValuesStore);
  log.debug('minute',minute);
  log.debug('offset',offset);

  if (indicatorValuesStore[offset].previousinput === null) {
    indicatorValuesStore[offset].previousinput = input;
  }
  let gain, loss, rsi;
  if (input > indicatorValuesStore[offset].previousinput) {
    gain = input - indicatorValuesStore[offset].previousinput;
    loss = 0;
  } else {
    gain = 0;
    loss = indicatorValuesStore[offset].previousinput - input;
  }
  //Minden X-ik elemet elmentjük
  if (candleId % minute === offset) {
    //Save X. input
    indicatorValuesStore[offset].previousinput = input;
    //RSI start
    indicatorValuesStore[offset].gains.push(gain);
    indicatorValuesStore[offset].losses.push(loss);
    if (indicatorValuesStore[offset].losses.length === this.size.rsi) {
      indicatorValuesStore[offset].gainWilderAvg = this.calculateWilder(
        indicatorValuesStore[offset].gains,
        indicatorValuesStore[offset].gainWilderAvg);
      indicatorValuesStore[offset].lossWilderAvg = this.calculateWilder(
        indicatorValuesStore[offset].losses,
        indicatorValuesStore[offset].lossWilderAvg);
      rsi = this.calculateRSI(
        indicatorValuesStore[offset].gainWilderAvg,
        indicatorValuesStore[offset].lossWilderAvg
      );
      indicatorValuesStore[offset].gains.shift();
      indicatorValuesStore[offset].losses.shift();
      //RSI end
      //Stochastic start
      indicatorValuesStore[offset].rsis.push(rsi);
      if (indicatorValuesStore[offset].rsis.length === this.size.stoch) {
        let min = _.min(indicatorValuesStore[offset].rsis);
        let max = _.max(indicatorValuesStore[offset].rsis);
        indicatorValuesStore[offset].k.push(this.calculateStochastic(min,max,rsi));
        indicatorValuesStore[offset].rsis.shift();
        //Stochastic end
        //%K start
        if (indicatorValuesStore[offset].k.length === this.size.k) {
          //EMA
          /*indicatorValuesStore[offset].avgK = this.calculateEMA(
            indicatorValuesStore[offset].k,
            indicatorValuesStore[offset].avgK);*/
          //Wilder
          indicatorValuesStore[offset].avgK = this.calculateWilder(
            indicatorValuesStore[offset].k,
            indicatorValuesStore[offset].avgK);
          indicatorValuesStore[offset].k.shift();
          //%K end
          //%D start
          indicatorValuesStore[offset].d.push(indicatorValuesStore[offset].avgK);
          if (indicatorValuesStore[offset].d.length === this.size.d) {
            //EMA
            /*indicatorValuesStore[offset].avgD = this.calculateEMA(
              indicatorValuesStore[offset].d,
              indicatorValuesStore[offset].avgD);*/
            //Wilder
            indicatorValuesStore[offset].avgD = this.calculateWilder(
              indicatorValuesStore[offset].d,
              indicatorValuesStore[offset].avgD);
            indicatorValuesStore[offset].d.shift();
            //Saving results
            /*this.indicatorResults[offset].superK = indicatorValuesStore[offset].avgK;
            this.indicatorResults[offset].superD = indicatorValuesStore[offset].avgD;*/
            log.debug('indicatorValuesStore[offset].avgK',indicatorValuesStore[offset].avgK);
            log.debug('indicatorValuesStore[offset].avgD',indicatorValuesStore[offset].avgD);
            return {
              superK: indicatorValuesStore[offset].avgK,
              superD: indicatorValuesStore[offset].avgD
            };
          }
          //%D end
        }
      }
    }
  } else {
    //Moving start
    //Not saveing input
    if (indicatorValuesStore[offset].d.avgD !== null) {
      //RSI start
      let gainWilderAvg = this.calculateWilder(
        indicatorValuesStore[offset].gains.concat(gain),
        indicatorValuesStore[offset].gainWilderAvg);
      let lossWilderAvg = this.calculateWilder(
        indicatorValuesStore[offset].losses.concat(loss),
        indicatorValuesStore[offset].lossWilderAvg);
      rsi = this.calculateRSI(gainWilderAvg, lossWilderAvg);
      //RSI end
      //Stochastic start
      let min = _.min(indicatorValuesStore[offset].rsis.concat(rsi));
      let max = _.max(indicatorValuesStore[offset].rsis.concat(rsi));
      let stochrsi = this.calculateStochastic(min, max, rsi);
      //Stochastic end
      //%K start
      let avgK = this.this.calculateEMA(
        indicatorValuesStore[offset].k.concat(stochrsi),
        indicatorValuesStore[offset].avgK);
      //%K end
      //%D start
      let avgD = this.this.calculateEMA(
        indicatorValuesStore[offset].d.concat(avgK),
        indicatorValuesStore[offset].avgD);
      //%D end
      //Saving results
      /*this.indicatorResults[offset].superK = avgK;
      this.indicatorResults[offset].superD = avgD;*/
      log.debug('indicatorValuesStore[offset].avgK',indicatorValuesStore[offset].avgK);
      log.debug('indicatorValuesStore[offset].avgD',indicatorValuesStore[offset].avgD);
      return {
        superK: avgK,
        superD: avgD
      };
    }
  }
}

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
  };
  this.digits = 8;
  this.indicatorValues = {
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
  };
  this.oneMinuteValues = [null];
  //this.oneMinuteValues.push(this.indicatorValues);

  this.fiveMinuteValues = [null,null,null,null,null];
  //this.fiveMinuteValues.push(this.indicatorValues);

  this.xMinuteValues = [null,null,null,null,null];
  //this.xMinuteValues.push(this.indicatorValues);

  this.indicatorResults = {
    one: {},
    five: {},
    xmin: {}
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
    "start;age;open;high;low;close;avgall;1minwildK;1minwildD;5minwildK;5minwildD;XminwildK;XminwildD;muvelet\n",
    'utf8');
  this.sor = '';
}

// what happens on every new candle?
method.update = function(candle) {
  //TODO update
  log.debug('update');
  var a = (candle.open + candle.low + candle.high + candle.close) / 4;
  this.indicatorValues.gains.push(a);
  if (this.indicatorValues.gains.length > 3) {
    this.indicatorValues.gains.shift();
  }


  var b = this.calculateAverage(this.indicatorValues.gains);
  log.debug('b',b.toFixed(this.digits));


}

// for debugging purposes log the last
// calculated parameters.
method.log = function(candle) {
  log.debug('log');
  var SO = this.indicators.so;

  if (this.sor !== '') {
    fs.appendFileSync(this.fd,this.sor + "\n",'utf8');
  }

  var d = new Date(candle.start);

  //start;open;high;low;close;5minclose;15minclose;1minK;5minK;15minK;5minmovingK;15minmovingK,superk5,superk15
  this.sor =
    d.getFullYear() + '-' + (Number.parseInt(d.getMonth())+1) + '-' +d.getDate() + ' ' +
    d.toLocaleTimeString('hu-HU') + ';' + this.age + ";" +
    candle.open.toFixed(this.digits).replace(".", ",") + ';' +
    candle.high.toFixed(this.digits).replace(".", ",") + ';' +
    candle.low.toFixed(this.digits).replace(".", ",") + ';' +
    candle.close.toFixed(this.digits).replace(".", ",") + ';';
    /*this.aggPrevClose.min5.toFixed(this.digits).replace(".", ",") + ';' +
    this.aggPrevClose.min15.toFixed(this.digits).replace(".", ",") + ';' +
    SO.result.toFixed(this.digits).replace(".", ",") + ';' +
    k.min5.toFixed(this.digits).replace(".", ",") + ';' +
    k.min15.toFixed(this.digits).replace(".", ",") + ';' +
    mk.min5.toFixed(this.digits).replace(".", ",") + ';' +
    mk.min15.toFixed(this.digits).replace(".", ",") + ';' +
    superk.min5.toFixed(this.digits).replace(".", ",") + ';' +
    superk.min15.toFixed(this.digits).replace(".", ",") + ';';
  */
  //candle
  log.debug('candle.high: ', candle.high.toFixed(this.digits));
  log.debug('candle.open: ', candle.open.toFixed(this.digits));
  log.debug('candle.low: ', candle.low.toFixed(this.digits));
  log.debug('candle.close: ', candle.close.toFixed(this.digits));

}

method.check = function(candle) {
  var SO = this.indicators.so;
  var a = (candle.open + candle.low + candle.high + candle.close) / 4;
  log.debug('candle.high: ', candle.high.toFixed(this.digits));
  log.debug('candle.open: ', candle.open.toFixed(this.digits));
  log.debug('candle.low: ', candle.low.toFixed(this.digits));
  log.debug('candle.close: ', candle.close.toFixed(this.digits));
  log.debug('price',a.toFixed(this.digits));





  //calculating 5 minutes
  /*this.indicatorResults.one =
    this.calculateXMinuteMovingIndicator(price, this.age,this.fiveMinuteValues,1,0);
  log.debug('this.indicatorResults.one',this.indicatorResults.one);
  this.indicatorResults.five =
    this.calculateXMinuteMovingIndicator(price, this.age,this.fiveMinuteValues,5,0);
  this.indicatorResults.xmin =
    this.calculateXMinuteMovingIndicator(price, this.age,this.xMinuteValues,this.settings.superk.xmin,0);
  log.debug('this.indicatorResults ',this.indicatorResults);*/

}

module.exports = method;

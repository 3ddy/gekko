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
  if (value >= zone[0] && value <= zone[1]) return true;
  else return false;
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
 * Calculating Wilder's Movind Average
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
    rsi = 100 - 100 / (1 + Number.parseFloat(rs));
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
    return 0;
  } else {
    return ((rsi - min) / (max - min)) * 100;
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
 * @param {number} input Amiből számolunk StochRSI-t
 * @param {number} candleId Hányadik percben járunk
 * @param {array} indicatorValuesStore
 * @param {number} minute hány perces átlagot akarunk
 * @param {number} offset eltolás ha többet akarunk számolni
 * @param {number} avg EMA vagy Wilder //TODO nincs kész
 */
method.calculateXMinuteMovingIndicator = function (
  input,  //input data
  candleId, //age
  indicatorValuesStore = [],  //object for storing temporary data and results
  minute=5, //x minute average candle
  offset=0,  //if we one multiple X minutes value (0 <-> minute-1)
  avg = 0   //0 = EMA 1 = Wilder
) {
  //log.debug('input',input);
  //log.debug('candleId',candleId);
  //log.debug('indicatorValuesStore',indicatorValuesStore);
  //log.debug('minute',minute);
  //log.debug('offset',offset);

  if (indicatorValuesStore[offset].previousValue === null) {
    indicatorValuesStore[offset].previousValue = input;
  }
  let gain, loss, rsi;
  if (input > indicatorValuesStore[offset].previousValue) {
    gain = input - indicatorValuesStore[offset].previousValue;
    loss = 0;
  } else {
    gain = 0;
    loss = indicatorValuesStore[offset].previousValue - input;
  }
  //Minden X-ik elemet elmentjük
  if (candleId % minute === offset) {
    //Save X. input
    indicatorValuesStore[offset].previousValue = input;
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
          switch (avg) {
            case 0:
              //EMA
              indicatorValuesStore[offset].avgK = this.calculateEMA(
                indicatorValuesStore[offset].k,
                indicatorValuesStore[offset].avgK);
              break;
            case 1:
              //Wilder
              indicatorValuesStore[offset].avgK = this.calculateWilder(
                indicatorValuesStore[offset].k,
                indicatorValuesStore[offset].avgK);
              break;
          }
          indicatorValuesStore[offset].k.shift();
          //%K end
          //%D start
          indicatorValuesStore[offset].d.push(indicatorValuesStore[offset].avgK);
          if (indicatorValuesStore[offset].d.length === this.size.d) {
            switch (avg) {
              case 0:
                //EMA
                indicatorValuesStore[offset].avgD = this.calculateEMA(
                  indicatorValuesStore[offset].d,
                  indicatorValuesStore[offset].avgD);
                break;
              case 1:
                //Wilder
                indicatorValuesStore[offset].avgD = this.calculateWilder(
                  indicatorValuesStore[offset].d,
                  indicatorValuesStore[offset].avgD);
                break;
            }
            indicatorValuesStore[offset].d.shift();
            //Saving results
            /*this.indicatorResults[offset].superK = indicatorValuesStore[offset].avgK;
            this.indicatorResults[offset].superD = indicatorValuesStore[offset].avgD;*/
            //log.debug('indicatorValuesStore[offset].avgK',indicatorValuesStore[offset].avgK);
            //log.debug('indicatorValuesStore[offset].avgD',indicatorValuesStore[offset].avgD);
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
      log.debug('indicatorValuesStore[offset].rsis.concat(rsi)',indicatorValuesStore[offset].rsis.concat(rsi));
      let stochrsi = this.calculateStochastic(min, max, rsi);
      //Stochastic end
      //%K start
      let avgK = 0;
      switch (avg) {
        case 0:
          //EMA
          avgK = this.calculateEMA(
            indicatorValuesStore[offset].k.concat(stochrsi),
            indicatorValuesStore[offset].avgK);
          break;
        case 1:
          //Wilder
          avgK = this.calculateWilder(
            indicatorValuesStore[offset].k.concat(stochrsi),
            indicatorValuesStore[offset].avgK);
          break;
      }
      //%K end
      //%D start
      let avgD = 0;
      switch (avg) {
        case 0:
          //EMA
          avgD = this.calculateEMA(
            indicatorValuesStore[offset].d.concat(avgK),
            indicatorValuesStore[offset].avgD);
          break;
        case 1:
          //Wilder
          avgD = this.calculateWilder(
            indicatorValuesStore[offset].d.concat(avgK),
            indicatorValuesStore[offset].avgD);
          log.debug('wilderavgD',avgD);
          break;
      }
      //%D end
      //Saving results
      /*this.indicatorResults[offset].superK = avgK;
      this.indicatorResults[offset].superD = avgD;*/
      //log.debug('avgK',avgK);
      log.debug('avgD',avgD);
      return {
        superK: avgK,
        superD: avgD
      };
    }
  }
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
    avgD:null
  });
  //log.debug('INIT ---this.indicatorValues',this.indicatorValues);
  this.oneMinuteValues = [];
  this.oneMinuteValues.push(JSON.parse(this.indicatorValues));
  //log.debug('INIT ---this.oneMinuteValues',this.oneMinuteValues);

  this.fiveMinuteValues = [];
  while (this.fiveMinuteValues.length < 5) {
    this.fiveMinuteValues.push(JSON.parse(this.indicatorValues));
  }
  log.debug('INIT ---this.fiveMinuteValues',this.fiveMinuteValues.length);

  this.xMinuteValues = [];
  while (this.xMinuteValues.length < this.size.xmin) {
    this.xMinuteValues.push(JSON.parse(this.indicatorValues));
  }
  log.debug('INIT ---this.xMinuteValues',this.xMinuteValues.length);

  this.indicatorResults = {
    one: {},
    five: {},
    xmin: {}
  };
  this.avgall = {
    k:[],
    avgK: null,
    d:[],
    avgD: null
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
    "start;age;open;high;low;close;avgall;1minemaK;1minemaD;5minwildK;5minwildD;" +
    "XminwildK;XminwildD;avgall_K;avgall_D;sD5dist;avgallD_dist;avgallD_distdist;muvelet\n",
    'utf8');
  this.sor = '';
}

// what happens on every new candle?
method.update = function(candle) {
  //TODO update
  let avgall = (candle.open + candle.low + candle.high + candle.close) / 4;

  /*this.indicatorResults.one =
    this.calculateXMinuteMovingIndicator(avgall, this.age,this.oneMinuteValues,1,0,0);
  /*if (this.indicatorResults.five !== null) {
    let prevFiveavgD = this.indicatorResults.five.superD;
  }*/
  this.indicatorResults.five =
    this.calculateXMinuteMovingIndicator(avgall, this.age,this.fiveMinuteValues,5,0,1);
  /*this.indicatorResults.xmin =
    this.calculateXMinuteMovingIndicator(avgall, this.age,this.xMinuteValues,this.size.xmin,0,1);
*/
  //log.debug('this.indicatorResults.one',this.indicatorResults.one);
  log.debug('this.indicatorResults.five',this.indicatorResults.five);
  //log.debug('this.indicatorResults.xmin',this.indicatorResults.xmin);
/*
  this.avgall.k.push(avgall);
  if (this.avgall.k.length === this.size.avgk) {
    this.avgall.avgK = this.calculateWilder(this.avgall.k,this.avgall.avgK);
    this.avgall.k.shift();
    this.avgall.d.push(this.avgall.avgK);
    if (this.avgall.d.length === this.size.avgd) {
      if (this.avgall.avgD !== null) {
        let prevAvgallavgD = this.avgall.avgD;
      }
      this.avgall.avgD = this.calculateWilder(this.avgall.d,this.avgall.avgD);
      this.avgall.d.shift();
      if (this.distance.avgallD_dist) {
        let prevavgallD_dist = this.distance.avgallD_dist;
      }
      this.distance.avgallD_dist = this.calculateDistance(prevAvgallavgD,this.avgall.avgD);
      this.distance.avgallD_distdist = this.calculateDistance(prevavgallD_dist,this.distance.avgallD_dist);
      this.distance.sD5dist = this.calculateDistance(prevFiveavgD,this.indicatorResults.five.superD);



    }
  }*/
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
  let avgall = (candle.open + candle.high + candle.low + candle.close)/4;

  //"start;age;open;high;low;close;avgall;1minemaK;1minemaD;5minwildK;5minwildD;" +
  //"XminwildK;XminwildD;avgall_K;avgall_D;sD5dist;avgallD_dist;avgallD_distdist;muvelet\n",
  this.sor = '"' +
    d.getFullYear() + '-' + (Number.parseInt(d.getMonth())+1) + '-' +d.getDate() + ' ' +
    d.toLocaleTimeString('hu-HU') + '";' + this.age + ';' +
    candle.open.toFixed(this.digits).replace(".", ",") + ';' +
    candle.high.toFixed(this.digits).replace(".", ",") + ';' +
    candle.low.toFixed(this.digits).replace(".", ",") + ';' +
    candle.close.toFixed(this.digits).replace(".", ",") + ';' +
    avgall.toFixed(this.digits).replace(".", ",") + ';' +
    //this.indicatorResults.one.superK.toFixed(this.digits).replace(".", ",") + ';' +
    //this.indicatorResults.one.superD.toFixed(this.digits).replace(".", ",") + ';' +
    this.indicatorResults.five.superK.toFixed(this.digits).replace(".", ",") + ';' +
    this.indicatorResults.five.superD.toFixed(this.digits).replace(".", ",") + ';';/* +
    this.indicatorResults.xmin.superK.toFixed(this.digits).replace(".", ",") + ';' +
    this.indicatorResults.xmin.superD.toFixed(this.digits).replace(".", ",") + ';';/* +
    this.avgall.avgK.toFixed(this.digits * 2).replace(".", ",") + ';' +
    this.avgall.avgD.toFixed(this.digits * 2).replace(".", ",") + ';' +
    this.distance.sD5dist.toFixed(this.digits).replace(".", ",") + ';' +
    this.distance.avgallD_dist.toFixed(this.digits).replace(".", ",") + ';' +
    this.distance.avgallD_distdist.toFixed(this.digits).replace(".", ",") + ';';*/
};

method.check = function(candle) {
  let SO = this.indicators.so;
  log.debug('check',this.age);

};

module.exports = method;

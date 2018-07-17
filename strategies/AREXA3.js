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
  /*this.sor =
    d.getFullYear() + '-' + (Number.parseInt(d.getMonth())+1) + '-' +d.getDate() + ' ' +
    d.toLocaleTimeString('hu-HU') + ';' + this.age + ";" +
    candle.open.toFixed(this.digits).replace(".", ",") + ';' +
    candle.high.toFixed(this.digits).replace(".", ",") + ';' +
    candle.low.toFixed(this.digits).replace(".", ",") + ';' +
    candle.close.toFixed(this.digits).replace(".", ",") + ';' +
    this.aggPrevClose.min5.toFixed(this.digits).replace(".", ",") + ';' +
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
  this.indicatorResults.five =
    this.calculateXMinuteMovingIndicator(price, this.age,this.fiveMinuteValues,5,0);
  this.indicatorResults.xmin =
    this.calculateXMinuteMovingIndicator(price, this.age,this.xMinuteValues,this.settings.superk.xmin,0);
  log.debug('this.indicatorResults ',this.indicatorResults);*/
  //min-max érték mentése
 /* switch (this.prevCandle.buyevent) {
    case -1:
      //eladás után minimumot keresünk
      if (this.prevCandle.min > close) this.prevCandle.min = close;
      break;
    case 0:
      //itt nem volt semmi ezért törlünk mindent
      this.prevCandle.min = null;
      this.prevCandle.max = null;
      break;
    case 1:
      //vétel utána maximumot keresünk
      if (this.prevCandle.max < close) this.prevCandle.max = close;
      break;
  }

/*
    //Strategy ready to start
    var superK5Event = 0, superK15Event = 0; //1 buy | -1 sell | 0 nothing
    if (prevSuperK15 !== null && prevDistance15 !== null && this.prevDistance.min5.length === 4) {
      //TODO fordulas
      var fordulas5fent = false;
      var fordulas15fent = false;
      var fordulas5lent = false;
      var fordulas15lent = false;
      var fordulas15b = false;

      //K5 fordulás
      //fent
      if (this.prevDistance.min5[0] > 0 &&
        this.prevDistance.min5[1] > 0 &&
        this.prevDistance.min5[2] > 0 &&
        this.prevDistance.min5[3] < 0 ) {
        //2 növekszik és az aktuális fordul -> fent
        fordulas5fent = true;
        this.sor += "fordulasfent 5 ";
      }
      if (this.prevDistance.min5[0] < 0 &&
        this.prevDistance.min5[1] < 0 &&
        this.prevDistance.min5[2] < 0 &&
        this.prevDistance.min5[3] > 0 ) {
        //2 csökken és az aktuális fordul -> lent
        fordulas5lent = true;
        this.sor += "fordulaslent 5 ";
      }
      //K15 fordulás
      var irany = 0;

      //  Ha A + és B - ---> akkor esik a görbe, azaz DOWN
      //  Ha A - és B - ---> nem történik semmi, azaz DOWN
      //  Ha A - és B + ----> akkor nőni kezd a görbe, azaz UP
      //  Ha A + és B + ----> nem történik semmi, azaz UP.

      if (prevDistanceWilderAvg > 0 && this.distanceWilderAvg < 0) {
        irany = -1; //le
      } else if (prevDistanceWilderAvg < 0 && this.distanceWilderAvg < 0) {
        irany = -1; //le
      } else if (prevDistanceWilderAvg < 0 && this.distanceWilderAvg > 0) {
        irany = 1; //fel
      } else if (prevDistanceWilderAvg > 0 && this.distanceWilderAvg > 0) {
        irany = 1; //fel
      }
      //fent
      var prevZone = this.prevCandle.zone;
      if (this.distanceWilderAvg >= this.settings.thresholds.fordav15 && irany === 1) {
        this.prevCandle.zone = 1;
        this.sor += "zone 1 ";
      } else if (this.distanceWilderAvg <= (this.settings.thresholds.fordav15 * -1) && irany === -1) {
        this.prevCandle.zone = 4;
        this.sor += "zone 4 ";
      } else if (this.inZone(this.distanceWilderAvg, [0,this.settings.thresholds.fordav15]) &&
        irany === 1 && (prevZone === 1 || prevZone === 3)) {
        //(value >= zone[0] && value <= zone[1])
        this.prevCandle.zone = 2;
        this.sor += "zone 2 ";
      } else if (this.inZone(this.distanceWilderAvg, [(this.settings.thresholds.fordav15 * -1),0]) &&
        irany === -1 && (prevZone === 4 || prevZone === 6)) {
        this.prevCandle.zone = 5;
        this.sor += "zone 5 ";
      }else if (this.inZone(this.distanceWilderAvg, [(this.settings.thresholds.fordav15 * -1),0]) &&
        irany === -1 && prevZone === 2) {
        this.prevCandle.zone = 3;
        this.sor += "zone 3 ";
      } else if (this.inZone(this.distanceWilderAvg, [0,this.settings.thresholds.fordav15]) &&
        irany === 1 && prevZone === 5){
        this.prevCandle.zone = 6;
        this.sor += "zone 6 ";
      } else {
        this.sor += "NINCS UJ ZONA aktualis: " + this.prevCandle.zone + " ";
      }
      if (this.prevCandle.zone === 1 || this.prevCandle.zone === 5 || this.prevCandle.zone === 6) {
        fordulas15lent = true;
      }
      if (this.prevCandle.zone >= 2 && this.prevCandle.zone <= 4) {
        fordulas15fent = true;
      }
      if (fordulas15fent && fordulas15lent) {
        log.debug("prevDistance15",prevDistance15.toFixed(this.digits));
        log.debug("currentDistance15",currentDistance15.toFixed(this.digits));
        log.debug("this.distanceWilderAvg",this.distanceWilderAvg.toFixed(this.digits));
        log.debug("prevDistanceWilderAvg",prevDistanceWilderAvg.toFixed(this.digits));
      }

      if (this.trend.min5.direction === null || this.trend.min15.direction === null) {
        if (prevSuperK5 <= this.superK.min5) {
          this.trend.min5.direction = 1; //up
          this.trend.min5.duration = 1; //1 because this is the second value
        }
        else {
          this.trend.min5.direction = -1; //down
          this.trend.min5.duration = 1;
        }
        if (prevSuperK15 <= this.superK.min15) {
          this.trend.min15.direction = 1; //up
          this.trend.min15.duration = 1;
        }
        else {
          this.trend.min15.direction = -1; //down
          this.trend.min15.duration = 1;
        }
      } else {
        if (prevSuperK5 <= this.superK.min5 && this.trend.min5.direction === 1 ) {
          this.trend.min5.duration++; //line is going up
        } else if (prevSuperK5 > this.superK.min5 && this.trend.min5.direction === -1 ) {
          this.trend.min5.duration++; //line is going down
        } else if (prevSuperK5 <= this.superK.min5 && this.trend.min5.direction === -1) {
          //fordulás alul -> vétel
          this.trend.min5.direction = 1;
          this.trend.min5.duration = 1;
        } else {
          //fordulás felül -> eladás
          this.trend.min5.direction = -1;
          this.trend.min5.duration = 1;
        }
        if (prevSuperK15 <= this.superK.min15 && this.trend.min15.direction === 1 ) {
          this.trend.min15.duration++; //line is going up
          //this.sor += "15 fel ";
        } else if (prevSuperK15 > this.superK.min15 && this.trend.min15.direction === -1 ) {
          this.trend.min15.duration++; //line is going down
          //this.sor += "15 le ";
        } else if (prevSuperK15 <= this.superK.min15 && this.trend.min15.direction === -1) {
          //fordulás alul -> vétel
          this.trend.min15.direction = 1;
          this.trend.min15.duration = 1;
          //this.sor += "15 fel ";
        } else {
          //fordulás felül -> eladás
          this.trend.min15.direction = -1;
          this.trend.min15.duration = 1;
          //this.sor += "15 le ";
        }
      } //fordulas vege
      //log.debug("this.trend.min5.direction/dur: " + this.trend.min5.direction + " # " +this.trend.min5.duration);
      //log.debug("this.trend.min15.direction/dur: " + this.trend.min15.direction + " # " +this.trend.min15.duration);

      //TODO: vetel
      //1 vétel
      if (this.inZone(this.superK.min5,this.settings.thresholds.buyzone5_1) &&
        this.inZone(this.superK.min15,this.settings.thresholds.buyzone15_1) &&
        this.superK.min5 <= (this.superK.min15 + Number.parseFloat(this.settings.thresholds.dist1)) &&
        this.superK.min5 >= this.superK.min15 &&
        fordulas5lent && fordulas15lent) {
        superK5Event = 1;
        superK15Event = 1;
        this.sor += "vetel 1 ";
        log.debug("vetel 1");
      }
      //2 vétel
      if (this.inZone(this.superK.min5,this.settings.thresholds.buyzone5_2) &&
        this.inZone(this.superK.min15,this.settings.thresholds.buyzone15_2) &&
        Math.abs(this.superK.min5 - this.superK.min15) >= this.settings.thresholds.dist2 &&
        fordulas5lent && fordulas15lent) {
        superK5Event = 1;
        superK15Event = 1;
        this.sor += "vetel 2 ";
        log.debug("vetel 2");
      }
      //3 vétel
      if (this.inZone(this.superK.min5,this.settings.thresholds.buyzone5_3) &&
        this.inZone(this.superK.min15,this.settings.thresholds.buyzone15_3) &&
        this.superK.min5 >= this.superK.min15 &&
        fordulas5lent &&  fordulas15lent) {
        superK5Event = 1;
        superK15Event = 1;
        this.sor += "vetel 3 ";
        log.debug("vetel 3");
      }
      //4 vétel
      if (this.inZone(this.superK.min5,this.settings.thresholds.buyzone5_4) &&
        this.inZone(this.superK.min15,this.settings.thresholds.buyzone15_4) &&
        this.superK.min5 <= this.superK.min15 &&
        fordulas5lent &&  fordulas15lent) {
        superK5Event = 1;
        superK15Event = 1;
        this.sor += "vetel 4 ";
        log.debug("vetel 4");
      }
      //5 vétel
      if (Math.abs(this.superK.min5 - this.superK.min15) <= this.settings.thresholds.synckis &&
        fordulas5lent &&  fordulas15lent &&
        this.inZone(this.superK.min5,this.settings.thresholds.buyzone5_5) &&
        this.inZone(this.superK.min15,this.settings.thresholds.buyzone15_5)) {
        superK5Event = 1;
        superK15Event = 1;
        this.sor += "vetel 5 ";
        log.debug("vetel 5");
      }
      //6 vétel
      if (this.inZone(this.superK.min5,this.settings.thresholds.buyzone5_6) &&
        this.inZone(this.superK.min15,this.settings.thresholds.buyzone15_6) &&
        (this.superK.min5 - this.settings.thresholds.distinstant) <= this.superK.min15 &&
        fordulas5lent) {
        superK5Event = 1;
        superK15Event = 1;
        this.sor += "vetel 6 ";
        log.debug("vetel 6");
      }
      //7 vétel
      if (this.inZone(this.superK.min5,this.settings.thresholds.buyzone5_7) &&
        this.inZone(this.superK.min15,this.settings.thresholds.buyzone15_7) &&
        prevSuperK5 < prevSuperK15 &&
        this.superK.min5 > this.superK.min15) {
        superK5Event = 1;
        superK15Event = 1;
        this.sor += "vetel 7 ";
        log.debug("vetel 7");
      }
      //8 vétel
      if (fordulas15lent && this.prevCandle.min < close && this.prevCandle.buyevent !== 1 && this.settings.thresholds.buy8) {
        superK5Event = 1;
        superK15Event = 1;
        this.sor += "vetel 8 ";
        log.debug("vetel 8");
      }

      //TODO: eladas
      //1 eladás
      if (this.inZone(this.superK.min5,this.settings.thresholds.sellzone5_1) &&
        this.inZone(this.superK.min15,this.settings.thresholds.sellzone15_1) &&
        this.superK.min5 >= this.superK.min15 &&
        fordulas5fent && fordulas15lent) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 1 ";
        log.debug("eladas 1");
      }
      //2 eladás
      if (this.inZone(this.superK.min5,this.settings.thresholds.sellzone5_2) &&
        this.inZone(this.superK.min15,this.settings.thresholds.sellzone15_2) &&
        this.superK.min5 <= this.superK.min15 &&
        fordulas5fent && fordulas15fent) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 2 ";
        log.debug("eladas 2");
      }
      //3 eladás
      if (this.inZone(this.superK.min5,this.settings.thresholds.sellzone5_3) &&
        this.inZone(this.superK.min15,this.settings.thresholds.sellzone15_3) &&
        this.superK.min5 >= this.superK.min15 &&
        fordulas5fent && fordulas15lent) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 3 ";
        log.debug("eladas 3");
      }
      //4 eladás
      if (this.inZone(this.superK.min5,this.settings.thresholds.sellzone5_4) &&
        this.inZone(this.superK.min15,this.settings.thresholds.sellzone15_4) &&
        this.superK.min5 <= this.superK.min15 &&
        fordulas5fent && fordulas15fent) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 4 ";
        log.debug("eladas 4");
      }
      //5 eladás
      if (Math.abs(this.superK.min5 - this.superK.min15) <= this.settings.thresholds.synckis &&
        this.inZone(this.superK.min5,this.settings.thresholds.sellzone5_4) &&
        this.inZone(this.superK.min15,this.settings.thresholds.sellzone15_4) &&
        fordulas5fent && fordulas15fent) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 5 ";
        log.debug("eladas 5");
      }
      //6 eladás
      if (this.inZone(this.superK.min5,this.settings.thresholds.sellzone5_6) &&
        this.inZone(this.superK.min15,this.settings.thresholds.sellzone15_6) &&
        (this.superK.min5 - this.settings.thresholds.distinstant) <= this.superK.min15 &&
        fordulas5fent) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 6 ";
        log.debug("eladas 6");
      }
      //7 eladás
      if (this.inZone(this.superK.min5,this.settings.thresholds.sellzone5_7) &&
        this.inZone(this.superK.min15,this.settings.thresholds.sellzone15_7) &&
        this.superK.min5 < this.superK.min15 &&
        prevSuperK5 > prevSuperK15) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 7 ";
        log.debug("eladas 7");
      }
      //8 eladás
      if (fordulas15fent && this.prevCandle.max > close && this.prevCandle.buyevent !== -1 && this.settings.thresholds.sell8) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 8 ";
        log.debug("eladas 8");
      }


      //TODO ertekeles
      if ((superK5Event === 1 || superK15Event === 1) &&
        this.timeout >= this.settings.thresholds.timeout && this.prevCandle.buyevent !== 1 &&
        !this.inZone(this.superK.min5,this.settings.thresholds.nobuy5_3) &&
        !this.inZone(this.superK.min5,this.settings.thresholds.nobuy5_4) &&
        !this.inZone(this.superK.min15,this.settings.thresholds.nobuy15_1) &&
        !this.inZone(this.superK.min15,this.settings.thresholds.nobuy15_2)) {
        this.advice('long');
        this.sor += "+ Price: " + candle.close.toFixed(this.digits);
        log.debug("===VESZ===", candle.close.toFixed(this.digits));
        log.debug("prevSuperK5", prevSuperK5.toFixed(this.digits));
        log.debug("this.superK.min5", this.superK.min5.toFixed(this.digits));
        log.debug("prevSuperK15", prevSuperK15.toFixed(this.digits));
        log.debug("this.superK.min15", this.superK.min15.toFixed(this.digits));
        this.prevCandle.close = close;
        this.prevCandle.min = null;
        this.prevCandle.max = close;
        this.prevCandle.buyevent = 1;
        this.timeout = 0;
      }
      else if ((superK5Event === -1 || superK15Event === -1) &&
        this.timeout >= this.settings.thresholds.timeout && this.prevCandle.buyevent !== -1 &&
        !this.inZone(this.superK.min5,this.settings.thresholds.nosell5_3) &&
        !this.inZone(this.superK.min5,this.settings.thresholds.nosell5_4) &&
        !this.inZone(this.superK.min15,this.settings.thresholds.nosell15_1) &&
        !this.inZone(this.superK.min15,this.settings.thresholds.nosell15_2)) {
        this.advice('short');
        this.sor += "- Price: " + candle.close.toFixed(this.digits);
        log.debug("===ELAD===", candle.close.toFixed(this.digits));
        log.debug("prevSuperK5", prevSuperK5.toFixed(this.digits));
        log.debug("this.superK.min5", this.superK.min5.toFixed(this.digits));
        log.debug("prevSuperK15", prevSuperK15.toFixed(this.digits));
        log.debug("this.superK.min15", this.superK.min15.toFixed(this.digits));
        this.prevCandle.close = close;
        this.prevCandle.min = close;
        this.prevCandle.max = null;
        this.prevCandle.buyevent = -1;
        this.timeout = 0;
      }
      else this.advice();
      //log.debug('this.timeout',this.timeout);
      this.timeout++;
    }
   /
  }*/
}

module.exports = method;

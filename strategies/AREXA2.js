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
};

// prepare everything our method needs
method.init = function() {
  this.requiredHistory = this.tradingAdvisor.historySize;
  log.debug('this.tradingAdvisor.historySize: ', this.tradingAdvisor.historySize);
  this.addIndicator('so', 'SO', this.settings.fstochrsi);
  //Size
  this.size = {
    rsi: this.settings.fstochrsi.interval,
    stoch: this.settings.fstochrsi.stoch,
    k: this.settings.fstochrsi.k,
    d: this.settings.fstochrsi.d,
    min5: this.settings.superk.min5,
    min15: this.settings.superk.min15
  };
  this.digits = 8;
  //Aggregated Indicator variables
  //Aggregated previous close, every N th candle close
  this.aggPrevClose = {
    min5: null,
    min15: null
  };
  //Average gain/loss of aggregated candles
  this.aggAvgLoss = {
    min5: [],
    min15: []
  };
  this.aggAvgGain = {
    min5: [],
    min15: []
  };
  this.iterators = {
    i:0, //for 5 min aggAvgGain/Loss
    j:0, //for 15 min aggAvgGain/Loss
    k:0  //for moving summary
  };
  //Previous moving averages of aggregated candles
  this.aggPrevAvg = {
    min5: {
      gain: null,
      loss: null,
      k: null,
      d: null
    },
    min15: {
      gain: null,
      loss: null,
      k: null,
      d: null
    }
  };
  //Moving Stochastic RSI, every N th is equal to this.aggPrevAvg.[k,d]
  this.aggStochRSI = {
    min5: {
      k: null,
      d: null
    },
    min15: {
      k: null,
      d: null
    }
  };
  //Aggregated RSI history
  this.aggRSIHistory = {
    min5: [],
    min15: []
  };
  //Aggregated Stochastic %K
  this.aggAvgK = {
    min5: [],
    min15: []
  };
  //Aggregated Stochastic %D
  this.aggAvgD = {
    min5: [],
    min15: []
  };
  //avgK + 5minmovingK * 2 /3
  //avgK + 15minmovingK * 2 /3
  this.weightedK = {
    min5: [],
    min15: []
  };
  //superk15 előtti átlaghoz kell
  this.addSuperK15 = [];
  this.superK = {
    min5: null,
    min15:null
  };

  this.age = 0;

  this.prevCandle = {
    close: 0,
    min: null, //minimum price since last sell
    max: null, //maximum price since last buy
    zone: 0, //5, 6, 1 a vételi zónák 2, 3, 4 az eladási zónák
    buyevent: 0 // -1 SELL 0 none or emergency sell 1 BUY
  };
  this.trend = {
    min5: { direction: null, duration: null },
    min15: { direction: null, duration: null }
  };
  //aktuális - előző superk értéke
  this.prevDistance = {
    min5: [], //saving the last 3
    min15: [], //because of moving summary
    dist15: [] //previous distance of distance15
  };
  //15 min distance összege
  this.distanceWilderAvg = 0;
  //Nincs művelet amíg le nem tellik
  this.timeout = this.settings.thresholds.timeout;

  try {
    fs.unlinkSync('candles2.txt');
  } catch (e) {

  }
  this.fd = fs.openSync('candles2.txt','a');
  fs.appendFileSync(this.fd,
    "start;age;open;high;low;close;5minclose;15minclose;1minK;5minK;15minK;" +
    "5minmovingK;15minmovingK;superk5;superk15;dist5;dist15;muvelet\n",
    'utf8');
  this.sor = '';
}

// what happens on every new candle?
method.update = function(candle) {
  //TODO: candle aggregating
  /**
   * only candle.close is needed
   * this.settings.fstochrsi.interval - 1 * this.settings.candles for avgLoss/Gain
   */
  //log.debug('candle',candle);
  //log.debug('**** age ****',this.age);

  if (this.aggPrevClose.min5 === null || this.aggPrevClose.min15 === null) {
    this.aggPrevClose.min5 = candle.close;
    this.aggPrevClose.min15 = candle.close;
  }
  //Calculation gain/loss and storing for history
  if (this.age % 5 === 0) {
    //5 min candles
    var gain = {
      min5: 0,
      min15: 0
    };
    var loss = {
      min5: 0,
      min15: 0
    };
    if (candle.close > this.aggPrevClose.min5) {
      gain.min5 = candle.close - this.aggPrevClose.min5;
      loss.min5 = 0;
    } else {
      loss.min5 = this.aggPrevClose.min5 - candle.close;
      gain.min5 = 0;
    }
    this.aggAvgGain.min5[this.iterators.i] = gain.min5;
    this.aggAvgLoss.min5[this.iterators.i] = loss.min5;
    this.aggPrevClose.min5 = candle.close;
    this.iterators.i = (this.iterators.i + 1) % this.size.rsi;
    if (this.age % 15 === 0) {
      if (candle.close > this.aggPrevClose.min15) {
        gain.min15 = candle.close - this.aggPrevClose.min15;
        loss.min15 = 0;
      } else {
        loss.min15 = this.aggPrevClose.min15 - candle.close;
        gain.min15 = 0;
      }
      this.aggAvgGain.min15[this.iterators.j] = gain.min15;
      this.aggAvgLoss.min15[this.iterators.j] = loss.min15;
      this.aggPrevClose.min15 = candle.close;
      this.iterators.j = (this.iterators.j + 1) % this.size.rsi;
    }
    /*log.debug('this.iterators:',this.iterators);
    log.debug('this.aggAvgGain.min5.length:',this.aggAvgGain.min5.length);
    log.debug('this.aggAvgGain.min15.length:',this.aggAvgGain.min15.length);
    log.debug('this.aggAvgLoss.min5.length:',this.aggAvgLoss.min5.length);
    log.debug('this.aggAvgLoss.min15.length:',this.aggAvgLoss.min15.length);
    log.debug('this.aggPrevClose:',this.aggPrevClose);*/
//TODO: aktuális(utolsó) gain loss kell lejjebb
    //Calculating RS and RSI with Wilder's smoothing average
    //if (this.aggAvgGain.min15.lenght === this.size.rsi) {
    if (this.age >= this.size.rsi * 15 ) {
      //log.debug('------------starting rs: ',this.age);
      var rs = {
        min5: 0,
        min15: 0
      };
      var rsi = {
        min5: 0,
        min15: 0
      };
      //First RSI calculation
      if (this.aggPrevAvg.min5.gain === null) {
        this.aggPrevAvg.min5.gain = this.aggAvgGain.min5.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / _.size(this.aggAvgGain.min5);
        this.aggPrevAvg.min5.loss = this.aggAvgLoss.min5.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / _.size(this.aggAvgLoss.min5);
        rs.min5 = this.aggPrevAvg.min5.gain / this.aggPrevAvg.min5.loss;
      } else {
        this.aggPrevAvg.min5.gain = (this.aggPrevAvg.min5.gain * (this.size.rsi - 1) + Number.parseFloat(gain.min5)) / this.size.rsi;
        this.aggPrevAvg.min5.loss = (this.aggPrevAvg.min5.loss * (this.size.rsi - 1) + Number.parseFloat(loss.min5)) / this.size.rsi;
        rs.min5 = this.aggPrevAvg.min5.gain / this.aggPrevAvg.min5.loss;
      }
      rsi.min5 = 100 - 100 / (Number.parseFloat(1.0) + Number.parseFloat(rs.min5));
      //RSI=100 if average loss is 0 by definition
      if (this.aggPrevAvg.min5.loss === 0 && this.aggPrevAvg.min5.gain !== 0) {
        rsi.min5 = 100;
      } else if (this.aggPrevAvg.min5.loss === 0) {
        rsi.min5 = 0;
      }
      this.aggRSIHistory.min5.push(rsi.min5);
      if (this.age % 15 === 0){
        if (this.aggPrevAvg.min15.gain === null) {
          this.aggPrevAvg.min15.gain = this.aggAvgGain.min15.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / _.size(this.aggAvgGain.min15);
          this.aggPrevAvg.min15.loss = this.aggAvgLoss.min15.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / _.size(this.aggAvgLoss.min15);
          rs.min15 = this.aggPrevAvg.min15.gain / this.aggPrevAvg.min15.loss;
        } else {
          this.aggPrevAvg.min15.gain = (this.aggPrevAvg.min15.gain * (this.size.rsi - 1) + Number.parseFloat(gain.min15)) / this.size.rsi;
          this.aggPrevAvg.min15.loss = (this.aggPrevAvg.min15.loss * (this.size.rsi - 1) + Number.parseFloat(loss.min15)) / this.size.rsi;
          rs.min15 = this.aggPrevAvg.min15.gain / this.aggPrevAvg.min15.loss;
        }
        rsi.min15 = 100 - 100 / (Number.parseFloat(1.0) + Number.parseFloat(rs.min5));
        //RSI=100 if average loss is 0 by definition
        if (this.aggPrevAvg.min15.loss === 0 && this.aggPrevAvg.min15.gain !== 0) {
          rsi.min15 = 100;
        } else if (this.aggPrevAvg.min15.loss === 0) {
          rsi.min15 = 0;
        }
        this.aggRSIHistory.min15.push(rsi.min15);
      }
      //Calculating 5 min Full StochascticRSI with exponential moving average
      if (this.aggRSIHistory.min5.length > this.size.stoch) {
        this.aggRSIHistory.min5.shift();
        var min = _.min(this.aggRSIHistory.min5);
        var max = _.max(this.aggRSIHistory.min5);
        if (min === max){
          this.aggAvgK.min5.push(0);
        } else {
          this.aggAvgK.min5.push(
            (rsi.min5 - min) / (max - min) * 100
          );
        }
      }
      //Calculating 15 min Full StochascticRSI with exponential moving average
      if (this.aggRSIHistory.min15.length > this.size.stoch) {
        this.aggRSIHistory.min15.shift();
        var min = _.min(this.aggRSIHistory.min15);
        var max = _.max(this.aggRSIHistory.min15);
        if (min === max){
          this.aggAvgK.min15.push(0);
        } else {
          this.aggAvgK.min15.push(
            (rsi.min15 - min) / (max - min) * 100
          );
        }
      }
      if (this.aggAvgK.min5.length > this.size.k) {
        this.aggAvgK.min5.shift();
        //First %K calculation
        if (this.aggPrevAvg.min5.k === null) {
          this.aggPrevAvg.min5.k = this.aggAvgK.min5.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / _.size(this.aggAvgK.min5);
        } else {
          //N = number of days in EMA, k = 2 / (N+1)
          let k = 2 / (Number.parseInt(this.size.k) + 1);
          //EMA = Value(t) * k + EMA(t-1) * (1 – k)
          this.aggPrevAvg.min5.k = this.aggAvgK.min5.slice(-1)[0] * k + this.aggPrevAvg.min5.k * (1 - k);
        }
        //Saving current %K and %D
        this.aggStochRSI.min5.k = this.aggPrevAvg.min5.k;
      }
      if (this.aggAvgK.min15.length > this.size.k) {
        this.aggAvgK.min15.shift();
        //First %K calculation
        if (this.aggPrevAvg.min15.k === null) {
          this.aggPrevAvg.min15.k = this.aggAvgK.min15.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / _.size(this.aggAvgK.min15);
        } else {
          //N = number of days in EMA, k = 2 / (N+1)
          let k = 2 / (Number.parseInt(this.size.k) + 1);
          //EMA = Value(t) * k + EMA(t-1) * (1 – k)
          this.aggPrevAvg.min15.k = this.aggAvgK.min15.slice(-1)[0] * k + this.aggPrevAvg.min15.k * (1 - k);
        }
        //Saving current %K and %D
        this.aggStochRSI.min15.k = this.aggPrevAvg.min15.k;
      }
    }
  } else if (_.size(this.aggAvgK.min15) === this.size.k && this.aggPrevAvg.min15.k !== null) {
    //Aggregated 5 min Stochastic RSI %K full
    var gain = 0;
    var loss = 0;
    if (candle.close > this.aggPrevClose.min5) {
      gain = candle.close - this.aggPrevClose.min5;
      loss = 0;
    } else {
      loss = this.aggPrevClose.min5 - candle.close;
      gain = 0;
    }
    gain = (this.aggPrevAvg.min5.gain * (this.size.rsi - 1) + gain) / this.size.rsi;
    loss = (this.aggPrevAvg.min5.loss * (this.size.rsi - 1) + loss) / this.size.rsi;
    let rs = gain / loss;
    let rsi = 100 - 100 / (1 + rs);
    //RSI=100 if average loss is 0 by definition
    if (loss === 0 && gain !== 0) {
      rsi = 100;
    } else if (loss === 0) {
      rsi = 0;
    }
    let rsihist = _.last(this.aggRSIHistory.min5,this.size.rsi - 1).concat(rsi);
    let min = _.min(rsihist);
    let max = _.max(rsihist);
    var stochrsi = null;
    if (max === min) {
      log.debug('rsimax5 == rsimin5');
      log.debug('rsihist5',rsihist);
      stochrsi = 0;
    } else {
      stochrsi = (rsi - min) / (max - min) * 100;
    }
    let k = 2 / (this.size.k + 1);
    //Saving current %K and %D
    this.aggStochRSI.min5.k = stochrsi * k + this.aggPrevAvg.min5.k * (1 - k);

    //Aggregated 15 min Stochastic RSI %K full
    if (candle.close > this.aggPrevClose.min15) {
      gain = candle.close - this.aggPrevClose.min15;
      loss = 0;
    } else {
      loss = this.aggPrevClose.min15 - candle.close;
      gain = 0;
    }
    gain = (this.aggPrevAvg.min15.gain * (this.size.rsi - 1) + gain) / this.size.rsi;
    loss = (this.aggPrevAvg.min15.loss * (this.size.rsi - 1) + loss) / this.size.rsi;
    rs = gain / loss;
    rsi = 100 - 100 / (1 + rs);
    //RSI=100 if average loss is 0 by definition
    if (loss === 0 && gain !== 0) {
      rsi = 100;
    } else if (loss === 0) {
      rsi = 0;
    }
    rsihist = _.last(this.aggRSIHistory.min15,this.size.rsi - 1).concat(rsi);
    min = _.min(rsihist);
    max = _.max(rsihist);
    if (max === min) {
      log.debug('rsimax15 == rsimin15');
      log.debug('rsihist15',rsihist);
      stochrsi = 0;
    } else {
      stochrsi = (rsi - min) / (max - min) * 100;
    }
    k = 2 / (this.size.k + 1);
    //Saving current %K and %D
    this.aggStochRSI.min15.k = stochrsi * k + this.aggPrevAvg.min15.k * (1 - k);

    /*log.debug('---- Moving ----');
    log.debug('candle.close', candle.close.toFixed(this.digits));
    log.debug('this.aggPrevAvg.min5.k', this.aggPrevAvg.min5.k.toFixed(this.digits));
    log.debug('this.aggPrevAvg.min15.k', this.aggPrevAvg.min15.k.toFixed(this.digits));
    log.debug("aggStochRSI.min5.k: " + this.aggStochRSI.min5.k.toFixed(this.digits));
    log.debug("aggStochRSI.min15.k: " + this.aggStochRSI.min15.k.toFixed(this.digits));*/
  }
}

// for debugging purposes log the last
// calculated parameters.
method.log = function(candle) {
  var SO = this.indicators.so;
  //SO.d.result SO.k (fast %K) SO.result = SO.avgK.result (full %K)

  /*log.debug('SO.d: ', SO.d.result.toFixed(this.digits));
  log.debug("SO.k: " + SO.k.toFixed(this.digits));
  log.debug("SO.result: " + SO.result.toFixed(this.digits));
  log.debug("SO.avgK.result: " + SO.avgK.result.toFixed(this.digits));*/
  var k = {
    min5: this.aggPrevAvg.min5.k===null?0:this.aggPrevAvg.min5.k,
    min15: this.aggPrevAvg.min15.k===null?0:this.aggPrevAvg.min15.k
  };
  var mk = {
    min5: this.aggStochRSI.min5.k===null?0:this.aggStochRSI.min5.k,
    min15: this.aggStochRSI.min15.k===null?0:this.aggStochRSI.min15.k
  };
  var superk = {
    min5: this.superK.min5===null?0:this.superK.min5,
    min15: this.superK.min15===null?0:this.superK.min15
  };
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
  /*
  //candle
  log.debug('candle.high: ', candle.high.toFixed(this.digits));
  log.debug('candle.open: ', candle.open.toFixed(this.digits));
  log.debug('candle.low: ', candle.low.toFixed(this.digits));
  log.debug('candle.close: ', candle.close.toFixed(this.digits));
*/
}

method.check = function(candle) {
  var SO = this.indicators.so;
  //min-max érték mentése
  switch (this.prevCandle.buyevent) {
    case -1:
      //eladás után minimumot keresünk
      if (this.prevCandle.min > candle.close) this.prevCandle.min = candle.close;
      break;
    case 0:
      //itt nem volt semmi ezért törlünk mindent
      this.prevCandle.min = null;
      this.prevCandle.max = null;
      break;
    case 1:
      //vétel utána maximumot keresünk
      if (this.prevCandle.max < candle.close) this.prevCandle.max = candle.close;
      break;
  }

  //Calculating SuperK
  if (_.size(this.aggAvgK.min15) == this.size.k && this.aggPrevAvg.min15.k !== null && this.aggStochRSI.min15.k!==null) {
    var prevSuperK5 = this.superK.min5;
    var prevSuperK15 = this.superK.min15;
    var prevDistance5 = _.last(this.prevDistance.min5);
    var prevDistance15 = (this.iterators.k - 1 < 0)?null:this.prevDistance.min15[this.iterators.k - 1];
    var currentDistance15 = null;
    /*
      Wilder = előző * (db-1) + aktuális / db
     */
    this.weightedK.min5.push((Number.parseFloat(SO.result) + this.aggStochRSI.min5.k * 2) / 3);
    if (this.weightedK.min5.length > this.size.min5) {
      this.weightedK.min5.shift();
      //log.debug('this.weightedK.min5: ',this.weightedK.min5);
      if (this.superK.min5 === null){
        this.superK.min5 = this.weightedK.min5.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / this.weightedK.min5.length;
      } else {
        this.superK.min5 = (this.superK.min5 * (this.size.min5 - 1) + _.last(this.weightedK.min5)) / this.size.min5;
      }
      //log.debug('this.superK.min5: ', this.superK.min5.toFixed(this.digits));
      this.prevDistance.min5.push(this.superK.min5 - prevSuperK5);
      if (this.prevDistance.min5.length > 4) this.prevDistance.min5.shift();
      this.sor += _.last(this.prevDistance.min5).toFixed(this.digits).replace(".", ",") + ";";
    }
    //this.weightedK.min15.push((Number.parseFloat(SO.result) + this.aggStochRSI.min15.k * 2) / 3);
    this.weightedK.min15.push(this.aggStochRSI.min15.k);
    if (this.weightedK.min15.length > this.size.min15) {
      this.weightedK.min15.shift();
      //log.debug('this.weightedK.min15: ',this.weightedK.min15);
      this.addSuperK15.push(this.weightedK.min15.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / this.weightedK.min15.length);
      if (this.addSuperK15.length === 2){
        if(this.superK.min15 === null){
          this.superK.min15 = this.addSuperK15.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / 2;
        } else {
          this.superK.min15 = (this.superK.min15 + _.last(this.addSuperK15)) / 2;
        }
        //log.debug('this.superK.min15: ', this.superK.min15.toFixed(this.digits));
        currentDistance15 = this.superK.min15 - prevSuperK15;
        var regi = this.prevDistance.min15[this.iterators.k] || 0;
        //előző K15 távolságok aktuális - előző SuperK15
        this.prevDistance.min15[this.iterators.k] = currentDistance15;

        this.sor += this.prevDistance.min15[this.iterators.k].toFixed(this.digits).replace(".", ",") + ";";
        //this.sor += this.distanceWilderAvg.toFixed(this.digits).replace(".", ",") + ";";
        //log.debug("this.distanceWilderAvg: ",this.distanceWilderAvg.toFixed(this.digits));
        //log.debug("this.prevDistance.min15: ",this.prevDistance.min15);
        this.iterators.k = (this.iterators.k + 1) % this.settings.superk.dist15;
        var prevDistanceWilderAvg = this.distanceWilderAvg;
        if (this.iterators.k === 0 && this.distanceWilderAvg === 0){
          this.distanceWilderAvg = this.prevDistance.min15.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / this.settings.superk.dist15;
        } else {
          this.distanceWilderAvg = (this.distanceWilderAvg * (this.settings.superk.dist15 - 1) + (currentDistance15)) / this.settings.superk.dist15;
          //log.debug('this.distanceWilderAvg',this.distanceWilderAvg.toFixed(this.digits));
        }
        this.addSuperK15.shift();
      }
    }
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
        this.prevDistance.min5[3] < 0 /*&&
        this.prevDistance.min5[0] >= this.prevDistance.min5[1] &&
        this.prevDistance.min5[1] >= this.prevDistance.min5[2]*/) {
        //2 növekszik és az aktuális fordul -> fent
        fordulas5fent = true;
        this.sor += "fordulasfent 5 ";
      }
      if (this.prevDistance.min5[0] < 0 &&
        this.prevDistance.min5[1] < 0 &&
        this.prevDistance.min5[2] < 0 &&
        this.prevDistance.min5[3] > 0 /*&&
        this.prevDistance.min5[0] >= this.prevDistance.min5[1] &&
        this.prevDistance.min5[1] >= this.prevDistance.min5[2]*/) {
        //2 csökken és az aktuális fordul -> lent
        fordulas5lent = true;
        this.sor += "fordulaslent 5 ";
      }
      /*if (prevDistance5 < this.settings.thresholds.fordav5 &&
        this.prevDistance.min5 < this.settings.thresholds.fordav5 &&
        prevSuperK5 <= this.superK.min5 &&
        prevDistance5 >= 0) {
        fordulas5fent = true;
        //log.debug("++++5 fordulasfent")
        this.sor += "fordulasfent 5 ";
      }
      if (prevDistance5 > 0 && this.prevDistance.min5 < 0) {
        fordulas5fent = true;
        //log.debug("++++5 fordulas5fent")
        this.sor += "fordulas5fent 5 eles ";
      }
      //lent
      if (prevDistance5 > (this.settings.thresholds.fordav5 * -1) &&
        this.prevDistance.min5 > (this.settings.thresholds.fordav5 * -1) &&
        prevSuperK5 >= this.superK.min5 &&
        prevDistance5 < 0) {
        fordulas5lent = true;
        //log.debug("++++5 fordulaslent")
        this.sor += "fordulaslent 5 ";
      }
      if (prevDistance5 < 0 && this.prevDistance.min5 > 0) {
        fordulas5lent = true;
        //log.debug("++++5 fordulaslent")
        this.sor += "fordulaslent 5 eles ";
      }*/
      //K15 fordulás
      var irany = 0;
      /*
        Ha A + és B - ---> akkor esik a görbe, azaz DOWN
        Ha A - és B - ---> nem történik semmi, azaz DOWN
        Ha A - és B + ----> akkor nőni kezd a görbe, azaz UP
        Ha A + és B + ----> nem történik semmi, azaz UP.
       */
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
      if (fordulas15lent && this.prevCandle.min < candle.close && this.prevCandle.buyevent !== 1 && this.settings.thresholds.buy8) {
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
      if (fordulas15fent && this.prevCandle.max > candle.close && this.prevCandle.buyevent !== -1 && this.settings.thresholds.sell8) {
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
        this.prevCandle.close = candle.close;
        this.prevCandle.min = null;
        this.prevCandle.max = candle.close;
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
        this.prevCandle.close = candle.close;
        this.prevCandle.min = candle.close;
        this.prevCandle.max = null;
        this.prevCandle.buyevent = -1;
        this.timeout = 0;
      }
      else this.advice();
      //log.debug('this.timeout',this.timeout);
      this.timeout++;
    }
  }
}

module.exports = method;

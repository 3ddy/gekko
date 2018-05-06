// helpers
var _ = require('lodash');
var log = require('../core/log');
var fs = require('fs');
var Victor = require('victor');
var SO = require('./indicators/SO.js');
// let's create our own method
var method = {};

// prepare everything our method needs
method.init = function() {
  this.requiredHistory = this.tradingAdvisor.historySize;
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
    j:0  //for 15 min aggAvgGain/Loss
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
  this.superK = {
    min5: null,
    min15:null
  };

  this.age = 0;

  this.prevCandle = {
    close: 0,
    buyevent: 0 // -1 SELL 0 none or emergency sell 1 BUY
  };
  this.trend = {
    min5: { direction: null, duration: null },
    min15: { direction: null, duration: null }
  };
  this.prevDistance = {
    min5: null,
    min15: null
  };
  //Nincs művelet amíg le nem tellik
  this.timeout = this.settings.thresholds.timeout;

  try {
    fs.unlinkSync('candles.txt');
  } catch (e) {

  }
  this.fd = fs.openSync('candles.txt','a');
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
  } else if (_.size(this.aggAvgK.min15) == this.size.k && this.aggPrevAvg.min15.k !== null) {
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
  //Calculatin SuperK
  if (_.size(this.aggAvgK.min15) == this.size.k && this.aggPrevAvg.min15.k !== null && this.aggStochRSI.min15.k!==null) {
    var prevSuperK5 = this.superK.min5;
    var prevSuperK15 = this.superK.min15;
    var prevDistance5 = this.prevDistance.min5;
    var prevDistance15 = this.prevDistance.min15;
    this.weightedK.min5.push((Number.parseFloat(SO.result) + this.aggStochRSI.min5.k * 2) / 3);
    if (this.weightedK.min5.length > this.size.min5) {
      this.weightedK.min5.shift();
      //log.debug('this.weightedK.min5: ',this.weightedK.min5);
      this.superK.min5 = this.weightedK.min5.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / this.weightedK.min5.length;
      //log.debug('this.superK.min5: ', this.superK.min5.toFixed(this.digits));
      this.prevDistance.min5 = this.superK.min5 - prevSuperK5;
      this.sor += this.prevDistance.min5.toFixed(this.digits).replace(".", ",") + ";";
    }
    this.weightedK.min15.push((Number.parseFloat(SO.result) + this.aggStochRSI.min15.k * 2) / 3);
    if (this.weightedK.min15.length > this.size.min15) {
      this.weightedK.min15.shift();
      //log.debug('this.weightedK.min15: ',this.weightedK.min15);
      this.superK.min15 = this.weightedK.min15.reduce((sum, p) => Number.parseFloat(sum) + Number.parseFloat(p), 0) / this.weightedK.min15.length;
      //log.debug('this.superK.min15: ', this.superK.min15.toFixed(this.digits));
      //TODO szög sqrt -1 -> NAn de el kell tolni 50 nell lefelé a görbét hogy legyenek negativ szögek
      var prevmin15 = new Victor(1,prevSuperK15);
      var min15 = new Victor(1,this.superK.min15);
      this.prevDistance.min15 = this.superK.min15 - prevSuperK15;
      var ab = (prevSuperK15 - 50) * (this.superK.min15 - 50);
      var a = Math.sqrt((prevSuperK15 - 50) * (prevSuperK15 - 50));
      var b = Math.sqrt((this.superK.min15 - 50) * (this.superK.min15 - 50));
      var deg = Math.acos(ab / (a * b))*100;
      this.sor += this.prevDistance.min15.toFixed(this.digits).replace(".", ",") +
        ' | ' + ab.toFixed(2) + ' | ' + a.toFixed(2) +
        ' | ' + b.toFixed(2) + ' | ' + deg.toFixed(2) + ' | ' + min15.distance(prevmin15).toFixed(this.digits) + ";";
    }
    //Strategy ready to start
    var superK5Event = 0, superK15Event = 0; //1 buy | -1 sell | 0 nothing
    if (prevSuperK15 !== null && prevDistance15 !== null) {
      /*log.debug("prevDistance5",prevDistance5.toFixed(this.digits));
      log.debug("prevDistance15",prevDistance15.toFixed(this.digits));
      log.debug("this.prevDistance.min5",this.prevDistance.min5.toFixed(this.digits));
      log.debug("this.prevDistance.min15",this.prevDistance.min15.toFixed(this.digits));*/
      //TODO fordulas
      var fordulas5fent = false;
      var fordulas15fent = false;
      var fordulas5lent = false;
      var fordulas15lent = false;
      var fele = false;
      //fent
      if (prevDistance5 < this.settings.thresholds.fordav5 &&
        this.prevDistance.min5 < this.settings.thresholds.fordav5 &&
        prevDistance5 >= 0) {
        fordulas5fent = true;
        log.debug("++++5 fordulasfent")
        this.sor += "fordulasfent 5 ";
      }
      if (prevDistance15 < this.settings.thresholds.fordav15 &&
        this.prevDistance.min15 < this.settings.thresholds.fordav15 &&
        prevDistance15 >=0) {
        fordulas15fent = true;
        log.debug("++++15 fordulasfent")
        this.sor += "fordulasfent 15 ";
      }
      if (this.superK.min5 >= 90 &&
        prevDistance5 < (this.settings.thresholds.fordav5 / 2) &&
        this.prevDistance.min5 < (this.settings.thresholds.fordav5 / 2) ) {
        fordulas5fent = true;
        fele = true;
        log.debug("++++5 fordulasfent /2")
        this.sor += "fordulasfent 5/2 ";
      }
      if (this.superK.min15 >= 90 &&
        prevDistance15 < this.settings.thresholds.fordav15 &&
        this.prevDistance.min15 < this.settings.thresholds.fordav15 ) {
        fordulas15fent = true;
        fele = true;
        log.debug("++++15 fordulasfent /2")
        this.sor += "fordulasfent 15/2 ";
      }
      //lent
      if (prevDistance5 > (this.settings.thresholds.fordav5 * -1) &&
        this.prevDistance.min5 > (this.settings.thresholds.fordav5 * -1) &&
        prevDistance5 < 0) {
        fordulas5lent = true;
        log.debug("++++5 fordulaslent")
        this.sor += "fordulaslent 5 ";
      }
      if (prevDistance15 > (this.settings.thresholds.fordav15 * -1) &&
        this.prevDistance.min15 > (this.settings.thresholds.fordav15 * -1) &&
        prevDistance15 < 0) {
        fordulas15lent = true;
        log.debug("++++15 fordulaslent")
        this.sor += "fordulaslent 15 ";
      }
      if (this.superK.min5 <= 10 &&
        prevDistance5 > (this.settings.thresholds.fordav5 / -2) &&
        this.prevDistance.min5 > (this.settings.thresholds.fordav5 / -2) &&
        prevDistance5 < 0) {
        fordulas5lent = true;
        fele = true;
        log.debug("++++5 fordulaslent /2")
        this.sor += "fordulaslent 5/2 ";
      }
      if (this.superK.min15 <= 10 &&
        prevDistance15 > (this.settings.thresholds.fordav15 / -2)&&
        this.prevDistance.min15 > (this.settings.thresholds.fordav15 / -2) &&
        prevDistance15 < 0) {
        fordulas15lent = true;
        fele = true;
        log.debug("++++15 fordulaslent /2")
        this.sor += "fordulaslent 15/2 ";
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
          this.trend.min5.direction === 1;
          this.trend.min5.duration = 1;
        } else {
          //fordulás felül -> eladás
          this.trend.min5.direction === -1;
          this.trend.min5.duration = 1;
        }
        if (prevSuperK15 <= this.superK.min15 && this.trend.min15.direction === 1 ) {
          this.trend.min15.duration++; //line is going up
        } else if (prevSuperK15 > this.superK.min15 && this.trend.min15.direction === -1 ) {
          this.trend.min15.duration++; //line is going down
        } else if (prevSuperK15 <= this.superK.min15 && this.trend.min15.direction === -1) {
          //fordulás alul -> vétel
          this.trend.min15.direction === 1;
          this.trend.min15.duration = 1;
        } else {
          //fordulás felül -> eladás
          this.trend.min15.direction === -1;
          this.trend.min15.duration = 1;
        }
      } //fordulas vege
      //log.debug("this.trend.min5.direction/dur: " + this.trend.min5.direction + " # " +this.trend.min5.duration);
      //log.debug("this.trend.min15.direction/dur: " + this.trend.min15.direction + " # " +this.trend.min15.duration);

      //TODO: vetel
      //5 perces minimum 1 vétel + fordulás?
      if (this.superK.min5 <= this.settings.thresholds.buy5min &&
        this.superK.min15 <= this.settings.thresholds.buy5min15 &&
        (fordulas5lent || fordulas15lent) && fele) {
        superK5Event = 1;
        this.sor += "vetel 1 ";
        log.debug("vetel 1");
      }
      //szinkron minimum 2 vétel + fordulás?
      if (Math.abs(this.superK.min5 - this.superK.min15) <= this.settings.thresholds.synckis && (fordulas5lent || fordulas15lent)) {
        if (this.superK.min5 >= this.settings.thresholds.synczone1[0] &&
          this.superK.min5 <= this.settings.thresholds.synczone1[1]){
          superK5Event = 1;
          superK15Event = 1;
          this.sor += "vetel 2 ";
          log.debug("vetel 2");
        } else if (this.superK.min5 >= this.settings.thresholds.synczone2[0] &&
          this.superK.min5 <= this.settings.thresholds.synczone2[1]) {
          superK5Event = 1;
          superK15Event = 1;
          this.sor += "vetel 2 ";
          log.debug("vetel 2");
        } else if (this.superK.min15 >= this.settings.thresholds.synczone1[0] &&
          this.superK.min15 <= this.settings.thresholds.synczone1[1]){
          superK5Event = 1;
          superK15Event = 1;
          this.sor += "vetel 2 ";
          log.debug("vetel 2");
        } else if (this.superK.min15 >= this.settings.thresholds.synczone2[0] &&
          this.superK.min15 <= this.settings.thresholds.synczone2[1]) {
          superK5Event = 1;
          superK15Event = 1;
          this.sor += "vetel 2 ";
          log.debug("vetel 2");
        }
        /*log.debug('this.timeout',this.timeout);
        log.debug('this.superK.min5',this.superK.min5);
        log.debug('this.superK.min15',this.superK.min15);
        log.debug('this.settings.thresholds.nobuy15',this.settings.thresholds.nobuy15);
        if ((superK5Event === 1 || superK15Event === 1) && true) log.debug('--igaz');*/
      }
      //5 perces bezuhanás 3 vétel + fordulás?
      if (this.superK.min15 >= this.settings.thresholds.buy15zuh &&
        this.superK.min5 <= this.settings.thresholds.buy5zuh && (fordulas5lent || fordulas15lent)) {
        superK5Event = 1;
        superK15Event = 1;
        this.sor += "vetel 3 ";
        log.debug("vetel 3");
      }
      //15 perces minimum 4 vétel + fordulás?
      if (this.superK.min15 <= this.settings.thresholds.buy15min &&
        this.superK.min5 <= this.settings.thresholds.buy15min5 &&
        (fordulas5lent || fordulas15lent) && fele) {
        superK15Event = 1;
        this.sor += "vetel 4 ";
        log.debug("vetel 4");
      }
      //5 igeret foldje 5 vétel
      if ((fordulas5lent || fordulas15lent) &&
        this.superK.min5 >= this.settings.thresholds.heavenzone5[0] &&
        this.superK.min5 <= this.settings.thresholds.heavenzone5[1] &&
        this.superK.min15 >= this.settings.thresholds.heavenzone15[0] &&
        this.superK.min15 <= this.settings.thresholds.heavenzone15[1]) {
        superK15Event = 1;
        superK5Event = 1;
        this.sor += "vetel 5 ";
        log.debug("vetel 5");
      }


      //TODO: eladas
      // 5 perces maximum 1 eladas + fordulás?
      if (this.superK.min5 >= this.settings.thresholds.sell5min &&
        this.superK.min15 >= this.settings.thresholds.sell15min &&
        this.superK.min5 > this.superK.min15 && (fordulas5fent || fordulas15fent)) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 1 ";
        log.debug("eladas 1");
      }
      //szinkron maximum 2 eladas + fordulas?
      if (Math.abs(this.superK.min5 - this.superK.min15) <= this.settings.thresholds.synckis &&
        ((this.superK.min5 >= this.settings.thresholds.synczone3[0] &&
        this.superK.min5 <= this.settings.thresholds.synczone3[1]) ||
          (this.superK.min5 >= this.settings.thresholds.synczone4[0] &&
        this.superK.min5 <= this.settings.thresholds.synczone4[1])) &&
        (fordulas5fent || fordulas15fent)) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 2 ";
        log.debug("eladas 2");
      }
      //15 perces maximum 3 eladas + fordulás
      if (this.superK.min15 >= this.settings.thresholds.sell15top &&
        this.superK.min5 < this.superK.min15 && fordulas5fent && fele) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 3 ";
        log.debug("eladas 3");
      }
      //15 perces biztonsagi eladas 4 eladas + fordulas
      if (this.superK.min15 >= this.settings.thresholds.sellzone15[0] &&
        this.superK.min15 <= this.settings.thresholds.sellzone15[1] &&
        this.superK.min5 >= this.settings.thresholds.sellzone5[0] &&
        this.superK.min5 <= this.settings.thresholds.sellzone5[1] &&
        this.superK.min5 < this.superK.min15 && (fordulas5fent || fordulas15fent)) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 4 ";
        log.debug("eladas 4");
      }
      //15 halalzona eladás 5 azonnali
      if (this.superK.min15 >= this.settings.thresholds.deathzone15[0] &&
        this.superK.min15 <= this.settings.thresholds.deathzone15[1] &&
        this.superK.min5 >= this.settings.thresholds.deathzone5[0] &&
        this.superK.min5 <= this.settings.thresholds.deathzone5[1] && (fordulas5fent || fordulas15fent)) {
        superK5Event = -1;
        superK15Event = -1;
        this.sor += "eladas 5 -";
        log.debug("eladas 5");
        this.advice('short');
        this.timeout = 0;
        this.prevCandle.close = candle.close;
        this.prevCandle.buyevent = -1;
        log.debug("===ELAD===", candle.close.toFixed(this.digits));
        log.debug("prevSuperK5", prevSuperK5.toFixed(this.digits));
        log.debug("this.superK.min5", this.superK.min5.toFixed(this.digits));
        log.debug("prevSuperK15", prevSuperK15.toFixed(this.digits));
        log.debug("this.superK.min15", this.superK.min15.toFixed(this.digits));
      }

      /*if (this.age >= 1599) {
        log.debug("prevDistance5",prevDistance5.toFixed(this.digits));
        log.debug("prevDistance15",prevDistance15.toFixed(this.digits));
        log.debug("this.prevDistance.min5",this.prevDistance.min5.toFixed(this.digits));
        log.debug("this.prevDistance.min15",this.prevDistance.min15.toFixed(this.digits));
        log.debug("prevSuperK5", prevSuperK5.toFixed(this.digits));
        log.debug("this.superK.min5", this.superK.min5.toFixed(this.digits));
        log.debug("prevSuperK15", prevSuperK15.toFixed(this.digits));
        log.debug("this.superK.min15", this.superK.min15.toFixed(this.digits));
        log.debug("this.timeout", this.timeout);
        log.debug("superK5Event", superK5Event);
        log.debug("superK15Event", superK15Event);
        log.debug("fordulas5fent", fordulas5fent);
        log.debug("fordulas15fent", fordulas15fent);
        log.debug("fordulas5lent", fordulas5lent);
        log.debug("fordulas15lent", fordulas15lent);
        if (this.age==1611) {
          //exit(-1);
        }
      }*/

      //ertekeles
      if ((superK5Event === 1 || superK15Event === 1) &&
        this.timeout >= this.settings.thresholds.timeout && this.prevCandle.buyevent !== 1) {
        log.debug("prevDistance5",prevDistance5.toFixed(this.digits));
        log.debug("prevDistance15",prevDistance15.toFixed(this.digits));
        log.debug("this.prevDistance.min5",this.prevDistance.min5.toFixed(this.digits));
        log.debug("this.prevDistance.min15",this.prevDistance.min15.toFixed(this.digits));
        log.debug("prevSuperK5", prevSuperK5.toFixed(this.digits));
        log.debug("this.superK.min5", this.superK.min5.toFixed(this.digits));
        log.debug("prevSuperK15", prevSuperK15.toFixed(this.digits));
        log.debug("this.superK.min15", this.superK.min15.toFixed(this.digits));
        //nobuy
        if (this.superK.min15 < this.settings.thresholds.nobuy15) {
          this.advice('long');
          this.sor += "+";
          log.debug("===VESZ===", candle.close.toFixed(this.digits));
          log.debug("prevSuperK5", prevSuperK5.toFixed(this.digits));
          log.debug("this.superK.min5", this.superK.min5.toFixed(this.digits));
          log.debug("prevSuperK15", prevSuperK15.toFixed(this.digits));
          log.debug("this.superK.min15", this.superK.min15.toFixed(this.digits));
          this.prevCandle.close = candle.close;
          this.prevCandle.buyevent = 1;
          this.timeout = 0;
        }
      }
      else if ((superK5Event === -1 || superK15Event === -1) &&
        this.timeout >= this.settings.thresholds.timeout && this.prevCandle.buyevent !== -1) {
        log.debug("prevDistance5",prevDistance5.toFixed(this.digits));
        log.debug("prevDistance15",prevDistance15.toFixed(this.digits));
        log.debug("this.prevDistance.min5",this.prevDistance.min5.toFixed(this.digits));
        log.debug("this.prevDistance.min15",this.prevDistance.min15.toFixed(this.digits));
        log.debug("prevSuperK5", prevSuperK5.toFixed(this.digits));
        log.debug("this.superK.min5", this.superK.min5.toFixed(this.digits));
        log.debug("prevSuperK15", prevSuperK15.toFixed(this.digits));
        log.debug("this.superK.min15", this.superK.min15.toFixed(this.digits));
        if (this.superK.min15 >= this.settings.thresholds.nosell15[0] &&
          this.superK.min15 <= this.settings.thresholds.nosell15[1] &&
          this.superK.min5 > this.superK.min15) {
          //15 perces nem eladas
          log.debug("Nem adunk el NOSELL15");
        } else {
          this.advice('short');
          this.sor += "-";
          log.debug("===ELAD===", candle.close.toFixed(this.digits));
          log.debug("prevSuperK5", prevSuperK5.toFixed(this.digits));
          log.debug("this.superK.min5", this.superK.min5.toFixed(this.digits));
          log.debug("prevSuperK15", prevSuperK15.toFixed(this.digits));
          log.debug("this.superK.min15", this.superK.min15.toFixed(this.digits));
          this.prevCandle.close = candle.close;
          this.prevCandle.buyevent = -1;
          this.timeout = 0;
        }
      }
      else this.advice();
      //log.debug('this.timeout',this.timeout);
      this.timeout++;
    }
  }
}

module.exports = method;

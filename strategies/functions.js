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
            log.debug('indicatorValuesStore[offset].k',indicatorValuesStore[offset].k);
            log.debug('indicatorValuesStore[offset].d',indicatorValuesStore[offset].d);
            indicatorValuesStore[offset].movAvgK = indicatorValuesStore[offset].avgK;
            indicatorValuesStore[offset].movAvgD = indicatorValuesStore[offset].avgD;
            return {
              superK: indicatorValuesStore[offset].avgK,
              superD: indicatorValuesStore[offset].avgD
            };
          }
          //%D end
        }
      }
    }
  } else if (indicatorValuesStore[offset].d.avgD !== null) {
    //Moving start
    if (indicatorValuesStore[offset].movAvgK === null || indicatorValuesStore[offset].movAvgD === null) {
      indicatorValuesStore[offset].movAvgK = indicatorValuesStore[offset].avgK;
      indicatorValuesStore[offset].movAvgD = indicatorValuesStore[offset].avgD;
    }
    log.debug('----moving----');

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
    log.debug('indicatorValuesStore[offset].rsis.concat(rsi)', indicatorValuesStore[offset].rsis.concat(rsi));
    let stochrsi = this.calculateStochastic(min, max, rsi);
    //Stochastic end
    //%K start
    let avgK = 0;
    switch (avg) {
      case 0:
        //EMA
        avgK = this.calculateEMA(
          indicatorValuesStore[offset].k.concat(stochrsi),
          indicatorValuesStore[offset].movAvgK);
        break;
      case 1:
        //Wilder
        avgK = this.calculateWilder(
          indicatorValuesStore[offset].k.concat(stochrsi),
          indicatorValuesStore[offset].movAvgK);
        break;
    }
    indicatorValuesStore[offset].movAvgK = avgK;
    //%K end
    //%D start
    let avgD = 0;
    switch (avg) {
      case 0:
        //EMA
        avgD = this.calculateEMA(
          indicatorValuesStore[offset].d.concat(avgK),
          indicatorValuesStore[offset].movAvgD);
        break;
      case 1:
        //Wilder
        avgD = this.calculateWilder(
          indicatorValuesStore[offset].d.concat(avgK),
          indicatorValuesStore[offset].movAvgD);
        //log.debug('wilderavgD',avgD);
        break;
    }
    indicatorValuesStore[offset].movAvgK = avgK;
    indicatorValuesStore[offset].movAvgD = avgD;
    //%D end
    //Saving results
    /*this.indicatorResults[offset].superK = avgK;
    this.indicatorResults[offset].superD = avgD;*/
    //log.debug('avgK',avgK);
    log.debug('indicatorValuesStore[offset].k.concat(stochrsi)', indicatorValuesStore[offset].k.concat(stochrsi));
    log.debug('indicatorValuesStore[offset].d.concat(avgK)', indicatorValuesStore[offset].d.concat(avgK));
    log.debug('avgD', avgD);
    return {
      superK: avgK,
      superD: avgD,
    };
  }
};

module.exports = function(purse) {
  const pct = true;
  let breakdown = [
    18,
    10.9,
    6.9,
    4.9,
    4.1,
    3.625,
    3.375,
    3.125,
    2.925,
    2.725,
    2.525,
    2.325,
    2.125,
    1.925,
    1.825,
    1.725,
    1.625,
    1.525,
    1.425,
    1.325,
    1.225,
    1.125,
    1.045,
    0.965,
    0.885,
    0.805,
    0.775,
    0.745,
    0.715,
    0.685,
    0.655,
    0.625,
    0.595,
    0.57,
    0.545,
    0.52,
    0.495,
    0.475,
    0.455,
    0.435,
    0.415,
    0.395,
    0.375,
    0.355,
    0.335,
    0.315,
    0.295,
    0.279,
    0.265,
    0.257,
    0.251,
    0.245,
    0.241,
    0.237,
    0.235,
    0.233,
    0.231,
    0.229,
    0.227,
    0.225,
    0.223,
    0.221,
    0.219,
    0.217,
    0.215
  ];

  if (pct) breakdown = breakdown.map(pct => Math.round(pct * purse));
  // Build out payouts to 200 places
  for (var i = breakdown.length - 1; i < 199; i++) {
    // Reduce each payout position by $100
    let amt = breakdown[i] - 100;
    breakdown.push(amt < 0 ? 0 : amt);
  }
  return breakdown;
};
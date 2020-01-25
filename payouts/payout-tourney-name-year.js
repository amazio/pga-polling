module.exports = function(purse) {
  const pct = false;
  let breakdown = [
    980000,
    188000,
    48000,
    28000,
    40000,
    96000,
    68500,
    41000,
    19000,
    297000,
    275000,
    253000,
    231000,
    209000,
    198000,
    187000,
    176000,
    165000,
    154000,
    143000,
    132000,
    123200,
    114400,
    105600,
    96800,
    88000,
    84700,
    81400,
    78100,
    74800,
    71500,
    68200,
    64900,
    62150,
    59400,
    56650,
    53900,
    51700,
    49500,
    47300,
    45100,
    42900,
    40700,
    38500,
    36300,
    34100,
    31900,
    30140,
    28600,
    27720
  ];

  // Build out payouts to 200 places
  for (var i = breakdown.length - 1; i < 199; i++) {
    // Reduce each payout position by $100
    let amt = breakdown[i] - 100;
    breakdown.push(amt < 0 ? 0 : amt);
  }
  return breakdown;
};
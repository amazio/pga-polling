module.exports = {
  poll
};

function poll() {
  return new Promise(function(resolve, reject) {
    resolve('done')
  });
}
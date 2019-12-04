var createError = require('http-errors');
var express = require('express');
var path = require('path');
var logger = require('morgan');
var methodOverride = require('method-override');

/*
  dotenv (.env), database and settings document are all being
  loaded within the bin/www
*/

// Start polling engine
require('./services/polling').load();

var indexRouter = require('./routes/index');
var subscriptionsRouter = require('./routes/api/subscriptions');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(methodOverride('_method'));

app.use('/', indexRouter);
app.use('/api/subscriptions', subscriptionsRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});



module.exports = app;

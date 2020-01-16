"use strict";

var _         = require('lodash');
var Electron  = require('electron');
var Path      = require('path');
var Url       = require('url');
var WebSocket = require('ws');

var GdpConfig = require('../config/config-main');

var SourcesDirMediator = require('./sources_dir_mediator');
var SourcesApi = require('./sources_api');

var _versionStringToInt = function (str) {
  var parts = str.split('.');
  var result = 0;

  for (var i = 0; i < 3; i++) {
    result *= 100;
    result += parseInt(parts[i] || 0);
  }
  return result;
};

var _initSettings = function () {
  var version = _versionStringToInt(App.getVersion());

  App.settings = require('electron-settings');
  if (App.settings.get('version') == 20000) {
    // Nothing to do.
  }
  if (App.settings.get('version') == 20100) {
    if (App.settings.get('sourcesDir') == null)
      App.settings.delete('sourcesDir');
  }

  // Current version
  App.settings.set('version', version);

  // Defaults
  App.settings.setAll(_.defaults(App.settings.getAll(), {
    httpPort: 3333,
    display: {
      bgColor: 'black',
      bgImage: undefined,
    },
    sourcesDir: App.getPath('documents'),
  }));

  return Promise.resolve();
};

var _initDisplay = function () {
  return new Promise(function (resolve, reject) {
    let settings = App.settings.get('display');
    let Display  = require('./display');

    App.display = new Display({
      bgColor: settings.bgColor,
      bgImage: settings.bgImage
    });
    App.display.on('change', function () {
      App.settings.set('display', {
        bgColor: App.display.bgColor,
        bgImage: App.display.bgImage
      });
    });
    resolve();
  });
};

var _initSources = function () {
  let currentPath = App.settings.get('sourcesDir');
  let privatePath = App.getPath('userData');

  App.sourcesMediator = new SourcesDirMediator(privatePath, currentPath, GdpConfig);
  App.sources = App.sourcesMediator.sources;
//    App.sources.on('error', function (error) {
//      Electron.dialog.showErrorBox('Sources introuvables', error.message);
//    });
  App.sources.on('change', function () {
    App.settings.set('sourcesDir', App.sources.path);
  });
//    App.sources.setPath(App.settings.get('sourcesDir'));
//    App.sources.setUserDir(App.getPath('userData'));
  return Promise.resolve();
};

var _startHttpServer = function () {
  return new Promise(function (resolve, reject) {
    var Express         = require('express');
    var JsonBodyParser  = require('body-parser').json();
    var DisplayAPI      = require('./api/display')(App);
    var sourcesApi      = new SourcesApi(App.sourcesMediator);

    App.webApp = Express();
    if (App.isDev) {
      App.webApp.use(Express.static(Path.resolve(process.cwd(), 'app'))); // Built renderer
      App.webApp.use(Express.static(Path.resolve(process.cwd(), 'build', 'www'))); // Static resources
      App.webApp.use(Express.static(Path.resolve(process.cwd(), 'src', 'renderer'))); // To serve images and fonts
      App.webApp.use(Express.static(Path.resolve(process.cwd(), 'node_modules', '@fortawesome', 'fontawesome-free')));
    } else {
      App.webApp.use(Express.static(Path.resolve(process.resourcesPath, 'www')));
    }
    App.webApp.set('env', (App.isDev) ? 'development' : 'production');
    App.webApp.get('/api/display', DisplayAPI.show);
    App.webApp.get('/api/display/bgImage', DisplayAPI.bgImage);
    App.webApp.post('/api/display', JsonBodyParser, DisplayAPI.update);
    App.webApp.delete('/api/display', DisplayAPI.clear);
    App.webApp.get('/api/sources', sourcesApi.index.bind(sourcesApi));
//    App.webApp.put('/api/sources', JsonBodyParser, sourcesApi.update.bind(sourcesApi));
    App.webApp.get('/api/sources/:id.:ext', sourcesApi.download.bind(sourcesApi));
    App.webApp.get('/api/sources/:id', sourcesApi.show.bind(sourcesApi));

    var server = App.webApp.listen(App.settings.get('httpPort'));
    server.once('listening', resolve);
    server.once('error', reject);

    var wss = new WebSocket.Server({server});
    wss.on('connection', function (ws) {
      App.sources.on('change', function () {
        ws.send(JSON.stringify({
          command: 'sources.change',
          data: sourcesApi._getData('/api/sources'),
        }));
      });
      App.display.on('change', function () {
        ws.send(JSON.stringify({
          command: 'display.change',
          data: DisplayAPI.getData(),
        }));
      });
    });
  });
};

var _startUi = function () {
  return new Promise(function (resolve, reject) {
    var r = _.after(2, resolve);

    _startMainWindow().then(r);
    _startScreenWindow().then(r);
  });
};

var _loadURL = function (window, hashtag, noDevTools) {
  var port = App.settings.get("httpPort");

  if (!(noDevTools === true) && App.isDev)
    window.openDevTools();
  window.loadURL(`http://localhost:${port}/${hashtag}`);
};

var _startMainWindow = function () {
  return new Promise(function (resolve, reject) {
    App.mainWindow = new Electron.BrowserWindow({
      icon: App.getIcon(),
      show: false,
      width: 1200,
      height: 600,
    });
    _loadURL(App.mainWindow, '');
    App.mainWindow.on('closed', function () {
      App.mainWindow = null;
      App.quit();
    });
    App.mainWindow.on('ready-to-show', function () {
      var primary = Electron.screen.getPrimaryDisplay();
      var x       = (primary.size.width - App.mainWindow.getSize()[0]) / 2;
      var y       = (primary.size.height - App.mainWindow.getSize()[1]) / 2;

      App.mainWindow.setPosition(x, y);
      App.mainWindow.show();
      resolve();
    });
    var menu = (function () {
      var template = [];

      template.push({
        label: App.name,
        accelerator: 'Alt+G',
        submenu: [{
          label: 'Associer un appareil',
          click() {
            startAssociateWindow();
          }
        }, {
          type: 'separator',
        }, {
          label: 'Paramètres',
          click() {
            _startSettingsWindow();
          }
        }, {
          type: 'separator',
        }, {
          label: 'À propos',
          click() {
            startAboutWindow();
          }
        }, {
          label: 'Quitter',
          accelerator: 'CmdOrCtrl+Q',
          role: 'quit',
        }]
      });
      if (App.isDev) {
        template.push({
          label: 'Dev',
          submenu: [{
            label: 'Open dev tools',
            click() {
              App.mainWindow.openDevTools();
            }
          }]
        });
      }
      return Electron.Menu.buildFromTemplate(template);
    })();
    if (process.platform == 'darwin') {
      Electron.Menu.setApplicationMenu(menu);
    } else {
      Electron.Menu.setApplicationMenu(null);
      App.mainWindow.setMenu(menu);
    }
  });
};

var _startScreenWindow = function () {
  return new Promise(function (resolve, reject) {
    App.screenWindow = new Electron.BrowserWindow({
      icon: App.getIcon(),
      show: false
    });
    _loadURL(App.screenWindow, '#/screen');
    App.screenWindow.setMenu(null);
    App.screenWindow.on('closed', function () {
      App.screenWindow = null;
      App.quit();
    });
    App.screenWindow.on('ready-to-show', function () {
      var primary  = Electron.screen.getPrimaryDisplay();
      var external = Electron.screen.getAllDisplays().find(display => display.id != primary.id);

      if (external) {
        var pos = external.workArea;
        App.screenWindow.setPosition(pos.x, pos.y);
      }
      App.screenWindow.show();
      App.screenWindow.setFullScreen(true);
      resolve();
    });
  });
};

var _launched = function () {
  App.launched = true;
  App.emit('launched');
  return Promise.resolve();
};

var _launch = function (resolve, reject) {
  _initSettings()
    .then(_initDisplay)
    .then(_initSources)
    .then(_startHttpServer)
    .then(_startUi)
    .then(_launched)
    .catch(reject);
};

var _startSettingsWindow = function () {
  var win = new Electron.BrowserWindow({
    webPreferences: {nodeIntegration: true},
    parent: App.mainWindow,
    modal: true,
    icon: App.getIcon(),
    show: false,
    width: 500,
    height: 400,
  });
  win.setMenu(null);
  win.on('ready-to-show', function () {
    win.show();
  });
  _loadURL(win, '#/settings', true);
};

var startAssociateWindow = function () {
  var win = new Electron.BrowserWindow({
    webPreferences: {nodeIntegration: true},
    parent: App.mainWindow,
    modal: true,
    icon: App.getIcon(),
    show: false,
    width: 350,
    height: 300,
  });
  win.setMenu(null);
  win.on('ready-to-show', function () {
    win.show();
  });
  _loadURL(win, '#/associate', true);
};

var startAboutWindow = function () {
  var win = new Electron.BrowserWindow({
    webPreferences: {nodeIntegration: true},
    parent: App.mainWindow,
    modal: true,
    icon: App.getIcon(),
    show: false,
    width: 350,
    height: 300,
  });
  win.setMenu(null);
  win.on('ready-to-show', function () {
    win.show();
  });
  _loadURL(win, '#/about', true);
};

var App = module.exports = _.extend(Electron.app, {

  isDev: (process.env.NODE_ENV !== 'production'),

  settings: null,

  display: null,

  sources: null,

  webApp: null,

  mainWindow: null,

  screenWindow: null,

  launched: false,

  launch: _.once(function () {
    return new Promise(function (resolve, reject) {
      App.whenReady().then(_.bind(_launch, _launch, resolve, reject))
    });
  }),

  getIcon: function () {
    if (App.isDev)
      return Path.resolve(process.cwd(), 'build', 'icon.png');
    return Path.resolve(process.resourcesPath, 'icon.png');
  }

});

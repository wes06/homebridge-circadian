var Service, Characteristic;
var request = require('request');

/**
 * @module homebridge
 * @param {object} homebridge Export functions required to create a
 *                            new instance of this plugin.
 */
module.exports = function(homebridge){
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-better-http-rgb', 'HTTP-RGB', HTTP_CIRC);
};

/**
 * Parse the config and instantiate the object.
 *
 * @summary Constructor
 * @constructor
 * @param {function} log Logging function
 * @param {object} config Your configuration object
 */
function HTTP_CIRC(log, config) {

    // The logging function is required if you want your function to output
    // any information to the console in a controlled and organized manner.
    this.log = log;

    this.service                       = 'Light';
    this.name                          = config.name;

    this.http_method                   = config.http_method               || 'GET';
    this.username                      = config.username                  || '';
    this.password                      = config.password                  || '';

    // Handle the basic on/off
    this.switch = { powerOn: {}, powerOff: {} };

    if (typeof config.switch === 'object') {
        this.switch.status                 = config.switch.status;

        // Intelligently handle if config.switch.powerOn is an object or string.
        if (typeof config.switch.powerOn === 'object') {
            this.switch.powerOn.set_url    = config.switch.powerOn.url;
            this.switch.powerOn.body       = config.switch.powerOn.body;
        } else {
            this.switch.powerOn.set_url    = config.switch.powerOn;
        }

        // Intelligently handle if config.switch.powerOff is an object or string.
        if (typeof config.switch.powerOff === 'object') {
            this.switch.powerOff.set_url   = config.switch.powerOff.url;
            this.switch.powerOff.body      = config.switch.powerOff.body;
        } else {
            this.switch.powerOff.set_url   = config.switch.powerOff;
        }
    }

    // Local caching of color temp and brightness
    this.cache = {};

    // Handle brightness
    if (typeof config.brightness === 'object') {
        this.brightness = {};
        this.brightness.status         = config.brightness.status;
        this.brightness.set_url        = config.brightness.url            || this.brightness.status;
        this.brightness.http_method    = config.brightness.http_method    || this.http_method;
        this.cache.brightness = 0;
    } else {
        this.brightness = false;
        this.cache.brightness = 100;
    }

    // Color handling
    if (typeof config.color === 'object') {
        this.color = {};
        this.color.status              = config.color.status;
        this.color.set_url             = config.color.url                 || this.color.status;
        this.color.http_method         = config.color.http_method         || this.http_method;
        this.color.brightness          = config.color.brightness;
        this.cache.saturation = 0;
    } else {
        this.color = false;
    }

    this.has = { brightness: this.brightness || (typeof this.color === 'object' && this.color.brightness) };

}

/**
 *
 * @augments HTTP_CIRC
 */
HTTP_CIRC.prototype = {

    /** Required Functions **/
    identify: function(callback) {
        this.log('Identify requested!');
        callback();
    },

    getServices: function() {
        // You may OPTIONALLY define an information service if you wish to override
        // default values for devices like serial number, model, etc.
        var informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, 'HTTP Manufacturer')
            .setCharacteristic(Characteristic.Model, 'homebridge-better-http-rgb')
            .setCharacteristic(Characteristic.SerialNumber, 'HTTP Serial Number');

        switch (this.service) {
            case 'Light':
                this.log('creating Lightbulb');
                var lightbulbService = new Service.Lightbulb(this.name);

                if (this.switch.status) {
                    lightbulbService
                        .getCharacteristic(Characteristic.On)
                        .on('get', this.getPowerState.bind(this))
                        .on('set', this.setPowerState.bind(this));
                } else {
                    lightbulbService
                        .getCharacteristic(Characteristic.On)
                        .on('set', this.setPowerState.bind(this));
                }

                // Handle brightness
                if (this.has.brightness) {
                    this.log('... adding Brightness');
                    lightbulbService
                        .addCharacteristic(new Characteristic.Brightness())
                        .on('get', this.getBrightness.bind(this))
                        .on('set', this.setBrightness.bind(this));
                }
                // Handle color
                if (this.color) {
                    this.log('... adding Temperature');

                    lightbulbService
                        .addCharacteristic(new Characteristic.Saturation())
                        .on('get', this.getSaturation.bind(this))
                        .on('set', this.setSaturation.bind(this));
                }

                return [lightbulbService];

            default:
                return [informationService];

        } // end switch
    },

    //** Custom Functions **//

    /**
     * Gets power state of lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    getPowerState: function(callback) {
        if (!this.switch.status) {
            this.log.warn('Ignoring request, switch.status not defined.');
            callback(new Error('No switch.status url defined.'));
            return;
        }

        var url = this.switch.status;

        this._httpRequest(url, '', 'GET', function(error, response, responseBody) {
            if (error) {
                this.log('getPowerState() failed: %s', error.message);
                callback(error);
            } else {
                var powerOn = parseInt(responseBody) > 0;
                this.log('power is currently %s', powerOn ? 'ON' : 'OFF');
                callback(null, powerOn);
            }
        }.bind(this));
    },

    /**
     * Sets the power state of the lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    setPowerState: function(state, callback) {
        var url;
        var body;

        if (!this.switch.powerOn.set_url || !this.switch.powerOff.set_url) {
            this.log.warn('Ignoring request, powerOn.url or powerOff.url is not defined.');
            callback(new Error("The 'switch' section in your configuration is incorrect."));
            return;
        }

        if (state) {
            url = this.switch.powerOn.set_url;
            body = this.switch.powerOn.body;
        } else {
            url = this.switch.powerOff.set_url;
            body = this.switch.powerOff.body;
        }

        this._httpRequest(url, body, this.http_method, function(error, response, responseBody) {
            if (error) {
                this.log('setPowerState() failed: %s', error.message);
                callback(error);
            } else {
                this.log('setPowerState() successfully set to %s', state ? 'ON' : 'OFF');
                callback(undefined, responseBody);
            }
        }.bind(this));
    },

    /**
     * Gets brightness of lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    getBrightness: function(callback) {
        if (!this.has.brightness) {
            this.log.warn("Ignoring request; No 'brightness' defined.");
            callback(new Error("No 'brightness' defined in configuration"));
            return;
        }

        if (this.brightness) {
            this._httpRequest(this.brightness.status, '', 'GET', function(error, response, responseBody) {
                if (error) {
                    this.log('getBrightness() failed: %s', error.message);
                    callback(error);
                } else {
                    var level = parseInt(responseBody);
                    this.log('brightness is currently at %s %', level);
                    callback(null, level);
                }
            }.bind(this));
        } else {
            callback(null, this.cache.brightness);
        }
    },

    /**
     * Sets the brightness of the lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    setBrightness: function(level, callback) {
        if (!this.has.brightness) {
            this.log.warn("Ignoring request; No 'brightness' defined.");
            callback(new Error("No 'brightness' defined in configuration"));
            return;
        }
        this.cache.brightness = level;

        // If achromatic, then update brightness, otherwise, update HSL as RGB
        if (!this.color) {
            var url = this.brightness.set_url.replace('%s', level);

            this._httpRequest(url, '', this.brightness.http_method, function(error, response, body) {
                if (error) {
                    this.log('setBrightness() failed: %s', error);
                    callback(error);
                } else {
                    this.log('setBrightness() successfully set to %s %', level);
                    callback();
                }
            }.bind(this));
        } else {
            this._setTempBrightness(callback);
        }
    },

    /**
     * Gets the saturation of lightbulb.
     *
     * @param {function} callback The callback that handles the response.
     */
    getSaturation: function(callback) {
        if (this.color && typeof this.color.status !== 'string') {
            this.log.warn("Ignoring request; problem with 'color' variables.");
            callback(new Error("There was a problem parsing the 'color' section of your configuration."));
            return;
        }
        var url = this.color.status;

        this._httpRequest(url, '', 'GET', function(error, response, responseBody) {
            if (error) {
                this.log('... getSaturation() failed: %s', error.message);
                callback(error);
            } else {
                var rgb = responseBody;
                var levels = this._rgbToHsl(
                    parseInt(rgb.substr(0,2),16),
                    parseInt(rgb.substr(2,2),16),
                    parseInt(rgb.substr(4,2),16)
                );

                var saturation = levels[1];

                this.log('... saturation is currently %s', saturation);
                this.cache.saturation = saturation;
                callback(null, saturation);
            }
        }.bind(this));
    },

    /**
     * Sets the saturation of the lightbulb.
     *
     * @param {number} level The saturation of the new call.
     * @param {function} callback The callback that handles the response.
     */
    setSaturation: function(level, callback) {
        if (this.color && typeof this.color.set_url !== 'string') {
            this.log.warn("Ignoring request; problem with 'color' variables.");
            callback(new Error("There was a problem parsing the 'color' section of your configuration."));
            return;
        }
        this.log('Caching Saturation as %s ...', level);
        this.cache.saturation = level;

        this._setTempBrightness(callback);
    },

    /**
     * Sets the RGB value of the device based on the cached HSB values.
     *
     * @param {function} callback The callback that handles the response.
     */
    _setTempBrightness: function(callback) {
        
        this.cache.saturation, this.cache.brightness

        coolWhite = (4000 - (40*colorTemp))*brightness;
        warmWhite = 4000*brightness;



        var url = this.color.set_url.replace('%s', 'WR-' + r + '-' + g + '-' + b + '-' + c);

        this.log('_setTempBrightness converting S:%s B:%s to RGB:%s ...', this.cache.saturation, this.cache.brightness, r + g + b);

        this._httpRequest(url, '', this.color.http_method, function(error, response, body) {
            if (error) {
                this.log('... _setTempBrightness() failed: %s', error);
                callback(error);
            } else {
                this.log('... _setTempBrightness() successfully set to #%s', r + g + b);
                callback();
            }
        }.bind(this));
    },

    /** Utility Functions **/
    /**
     * Perform an HTTP request.
     *
     * @param {string} url URL to call.
     * @param {string} body Body to send.
     * @param {method} method Method to use.
     * @param {function} callback The callback that handles the response.
     */
    _httpRequest: function(url, body, method, callback) {
        request({
            url: url,
            body: body,
            method: method,
            rejectUnauthorized: false,
            auth: {
                user: this.username,
                pass: this.password
            }
        },
        function(error, response, body) {
            callback(error, response, body);
        });
    }
};
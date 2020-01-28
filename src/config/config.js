'use strict';

const Config = {

  formats: [
    {ext: 'odp',  type: 'powerpoint', needConvert: true},
    {ext: 'pps',  type: 'powerpoint', needConvert: true},
    {ext: 'ppt',  type: 'powerpoint', needConvert: true},
    {ext: 'pptx', type: 'powerpoint', needConvert: true},

    {ext: 'pdf',  type: 'pdf',        needConvert: false},

    {ext: 'png',  type: 'image',      needConvert: false},
    {ext: 'jpg',  type: 'image',      needConvert: false},
    {ext: 'jpeg', type: 'image',      needConvert: false},
    {ext: 'gif',  type: 'image',      needConvert: false},
  ],

};

module.exports = Config;

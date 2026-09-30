// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Bundle the prebuilt food database (assets/db/foods.db).
config.resolver.assetExts.push('db');

// The AI server and raw datasets must never end up in (or slow down) the app bundle.
const path = require('path');
const escape = (p) => p.replace(/[/\\^$.*+?()[\]{}|]/g, '\\$&');
config.resolver.blockList = [
  new RegExp(`^${escape(path.join(__dirname, 'server'))}[/\\\\].*`),
  new RegExp(`^${escape(path.join(__dirname, 'data-raw'))}[/\\\\].*`),
];

module.exports = config;

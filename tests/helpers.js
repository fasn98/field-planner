'use strict';
// Converte deslocamentos em metros (leste, norte) para lat/lng em torno de uma base fixa.
const BASE = { lat: -23.55, lng: -46.633 };
const R = 6371008.8, DEG = Math.PI / 180;
function at(east, north) {
  return {
    lat: BASE.lat + north / (R * DEG),
    lng: BASE.lng + east / (R * DEG * Math.cos(BASE.lat * DEG))
  };
}
function portal(id, east, north, extra) {
  return Object.assign({ id, nome: id, nivel: 8, chaves: 10, observacao: '' }, at(east, north), extra || {});
}
module.exports = { BASE, at, portal };

window.GMT = window.GMT || {};

(function (G) {
  'use strict';
  function quoteField(value) {
    var text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  function toCsv(columns, rows) {
    var header = columns.map(function (column) { return quoteField(column.label); }).join(',');
    var body = (rows || []).map(function (row) {
      return columns.map(function (column) { return quoteField(row[column.key]); }).join(',');
    });
    return '\uFEFF' + [header].concat(body).join('\r\n') + '\r\n';
  }
  function filenameStamp(date) {
    return (date || new Date()).toISOString().slice(0, 19).replace(/[-:T]/g, '');
  }
  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }
  G.csv = { toCsv: toCsv, filenameStamp: filenameStamp, download: download };
})(window.GMT = window.GMT || {});

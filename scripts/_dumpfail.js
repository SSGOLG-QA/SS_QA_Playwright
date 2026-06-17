const ExcelJS = require('exceljs');
(async () => {
  const wb = new ExcelJS.Workbook();
  const f = process.argv[2];
  await wb.xlsx.readFile(f);
  wb.eachSheet(ws => {
    let header = null, rows = [];
    ws.eachRow((row, n) => {
      const vals = row.values.slice(1).map(v => (v==null?'':(typeof v==='object'&&v.text?v.text:String(v))).trim());
      if (n===1) { header = vals; return; }
      rows.push(vals);
    });
    if (!header) return;
    const statusIdx = header.findIndex(h => /결과|status|판정/i.test(h));
    if (statusIdx<0) return;
    const realFail = rows.filter(r => /FAIL/i.test(r[statusIdx]||''));
    if (realFail.length) {
      console.log('\n##### SHEET: '+ws.name+' (FAIL '+realFail.length+') #####');
      console.log('HDR: '+header.join(' | '));
      realFail.forEach(r => console.log('  '+r.join(' | ')));
    }
  });
})();

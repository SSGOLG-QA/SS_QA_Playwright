const ExcelJS = require('exceljs');
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(process.argv[2]);
  wb.eachSheet(ws => {
    const rows = [];
    ws.eachRow((row, n) => {
      const vals = row.values.slice(1).map(v => (v==null?'':(typeof v==='object'&&v.text?v.text:String(v))).trim());
      rows.push(vals);
    });
    console.log('\n##### SHEET: '+ws.name+' (rows '+rows.length+') #####');
    rows.slice(0, 40).forEach((r,i) => console.log((i).toString().padStart(2)+': '+r.slice(0,8).join(' | ')));
  });
})();

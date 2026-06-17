const ExcelJS=require('exceljs');
(async()=>{const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(process.argv[2]);
const ws=wb.getWorksheet('요약');
ws.eachRow((row,n)=>{const cells=[];row.eachCell({includeEmpty:true},c=>{let v=c.value;if(v&&typeof v==='object'){if(v.result!==undefined)v='formula='+v.result;else if(v.richText)v=v.richText.map(t=>t.text).join('');else v=JSON.stringify(v);}cells.push(v);});console.log(n+': '+cells.join(' | '));});
})();

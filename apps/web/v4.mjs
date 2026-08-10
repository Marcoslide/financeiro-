import { chromium } from '@playwright/test';
const SP='/tmp/claude-0/-home-user-financeiro-/d4278b2e-13e4-5f07-8763-b4c6b9076237/scratchpad', SHOTS='/tmp/claude-0/-home-user-financeiro-/d4278b2e-13e4-5f07-8763-b4c6b9076237/scratchpad/shots3';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1500,height:940},deviceScaleFactor:1.35});
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()==='error')errs.push('con:'+m.text());});
await p.goto('file:///home/user/financeiro-/docs/produtos-app.html');
await p.evaluate(()=>new Promise(r=>{const q=indexedDB.deleteDatabase('produtos_shopee');q.onsuccess=q.onerror=()=>r();}));
await p.reload(); await p.waitForSelector('#openImport',{timeout:8000});
// importar base grande
await p.click('#openImport'); await p.setInputFiles('#file', SP+'/catalogo-grande.xlsx');
await p.click('#go'); await p.waitForSelector('.master-row',{timeout:20000}); await p.waitForTimeout(400);
const kpis=await p.locator('.kpi .val').allInnerTexts(); console.log('KPIs:',JSON.stringify(kpis));
await p.screenshot({path:SHOTS+'/a01-lista.png'});
// BUSCA 40x60 -> só relacionados
await p.fill('#search','40x60'); await p.waitForTimeout(500);
const countBusca=(await p.locator('#countline').innerText()).replace(/\n/g,' '); console.log('busca 40x60:',countBusca);
await p.locator('#expAll').click(); await p.waitForTimeout(300);
const skus=await p.locator('.subrow .mono').allInnerTexts();
const allHave4060=skus.every(s=>/40x60/i.test(s)); console.log('todas as variações visíveis são 40x60?',allHave4060,'(amostra',skus.slice(0,3),')');
await p.screenshot({path:SHOTS+'/a02-busca.png'});
// LIMPA busca -> catálogo volta
await p.fill('#search',''); await p.waitForTimeout(500);
console.log('após limpar busca:',(await p.locator('#countline').innerText()).replace(/\n/g,' ').slice(0,60));
// KPI sem família
await p.locator('.kpi.clickable',{hasText:'SKUs sem família'}).click(); await p.waitForTimeout(500);
const semFam=(await p.locator('#countline').innerText()).match(/([\d.]+) SKUs/); console.log('KPI sem família -> SKUs no resultado:',semFam&&semFam[1]);
// COMBINA 40x60 + sem família ; conta == selecionar todos
await p.fill('#search','40x60'); await p.waitForTimeout(600);
const combineCount=(await p.locator('#countline').innerText()).match(/([\d.]+) SKUs correspondentes/)[1];
// seleciona página, depois todos os do resultado
await p.check('#chkPage'); await p.waitForTimeout(200);
const selAll=await p.locator('#selAllF'); if(await selAll.count()){await selAll.click();await p.waitForTimeout(300);}
const bulkTxt=await p.locator('.bulkbar b').innerText(); console.log('40x60+semfam -> contador:',combineCount,'| barra de seleção:',bulkTxt);
await p.screenshot({path:SHOTS+'/a03-combina-selecao.png'});
// classifica criando família e aplica
await p.click('#bAssign'); await p.waitForSelector('.modal',{timeout:4000});
await p.click('#nf'); await p.fill('#qn','Quadro 40x60 Premium'); await p.fill('#qcost','32,50'); await p.click('#qcr'); await p.waitForTimeout(300);
await p.screenshot({path:SHOTS+'/a04-classify.png'});
await p.click('#ap'); await p.waitForTimeout(600);
// agora o filtro 40x60+sem família deve esvaziar
const afterClassify=(await p.locator('#countline').innerText()).match(/([\d.]+) SKUs correspondentes/)[1];
console.log('após classificar, 40x60+sem família -> SKUs:',afterClassify,'(esperado 0)');
// edição inline de preço de fechamento
await p.fill('#search',''); await p.locator('.select[data-f=family]').selectOption(''); await p.waitForTimeout(500);
await p.locator('.master-row .expander').first().click(); await p.waitForSelector('.subrow',{timeout:5000});
await p.locator('.cell-close[data-vclose]').first().click(); await p.waitForTimeout(150);
await p.locator('.cell-close input').first().fill('219,90'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
const priceCell=await p.locator('.cell-close[data-vclose]').first().innerText(); console.log('inline preço fechamento salvo:',priceCell.trim());
await p.screenshot({path:SHOTS+'/a05-inline.png'});
// persistência
await p.reload(); await p.waitForSelector('.master-row',{timeout:15000});
console.log('após reload KPIs:',JSON.stringify(await p.locator('.kpi .val').allInnerTexts()));
console.log('ERRORS:',errs.length?errs.slice(0,6):'none');
await b.close();

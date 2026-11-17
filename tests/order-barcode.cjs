'use strict';
const assert = require('node:assert/strict');
const { PDFPage, PDFDocument } = require('pdf-lib');
const { code128b } = require('../lib/order-barcode');
const { orderPdf } = require('../lib/order-pdf');

function checkReference(ref) {
    const encoded=code128b(ref);
    assert.ok(encoded,'expected valid printable ID');
    assert.equal(encoded.id,ref);
    assert.equal(encoded.symbology,'CODE128B');
    assert.equal(encoded.codes[0],104);
    assert.equal(encoded.codes.at(-1),106);
    assert.equal(encoded.codes.length,ref.length+3);
    assert.equal(encoded.modules.length,11*(ref.length+2)+13);
    const checksum=(104 + [...ref].reduce((total,c,i)=>total+(c.charCodeAt(0)-32)*(i+1),0))%103;
    assert.equal(encoded.checksum,checksum);
    assert.equal(encoded.codes.at(-2),checksum);
    assert.ok(/^1[01]+11$/.test(encoded.modules));
    // An independent pattern-level roundtrip proves each codeword corresponds to the exact public ID.
    const unpack=encoded.codes.slice(1,-2).map(code=>String.fromCharCode(code+32)).join('');
    assert.equal(unpack,ref);
}
for(const id of ['a1b2c3d4','TEST1234','00000000','ABCDEFGH','ABCDEF0123456789'])checkReference(id);
for(const invalid of ['',null,undefined,0,'short','<script>','inválido','abc12345 abc','a'.repeat(17)]){
    assert.equal(code128b(invalid),null);
}

const fix={
    id:'a1b2c3d4', name:'Cliente fictício',phone:'51999999999',
    items:[{quantity:1,product:'Panqueca de teste',option:'Único',cents:4200}],
    subtotal:4200,money:cents=>'R$ '+(cents/100).toFixed(2),
    payment:{method:'pix',label:'Pix',changeForCents:null},testMode:true
};
async function render(fulfillment,printWidth='58',id=fix.id){
    const before=process.env.ORDER_PRINT_WIDTH_MM;
    process.env.ORDER_PRINT_WIDTH_MM=printWidth;
    const draw=PDFPage.prototype.drawRectangle;
    const rectangles=[];
    PDFPage.prototype.drawRectangle=function(row){
        rectangles.push({...row, pageWidth:this.getWidth(),pageHeight:this.getHeight()});
        return draw.call(this,row);
    };
    try{
        const bytes=await orderPdf({...fix,id,fulfillment});
        return {pdf:await PDFDocument.load(bytes),rectangles,bytes};
    }finally{
        PDFPage.prototype.drawRectangle=draw;
        if(before===undefined)delete process.env.ORDER_PRINT_WIDTH_MM;
        else process.env.ORDER_PRINT_WIDTH_MM=before;
    }
}
(async()=>{
    const options=[
        {type:'delivery',city:'Nova Hartz',neighborhood:'Centro',street:'Rua Fictícia',number:'25',feeCents:700,location:null},
        {type:'pickup'},
        {type:'table',table:'2'}
    ];
    for(const size of ['58','40','a4']){
        for(const fulfillment of options){
            const {pdf,rectangles}=await render(fulfillment,size);
            const stripes=rectangles.filter(r=>r.height>30);
            assert.ok(stripes.length>20,'Missing vector Code128 stripes');
            assert.equal(pdf.getPages()[0].getWidth(),(size==='a4'?210:Number(size))*72/25.4);
            const minX=Math.min(...stripes.map(s=>s.x));
            const maxX=Math.max(...stripes.map(s=>s.x+s.width));
            assert.ok(minX>=0);
            assert.ok(maxX<=pdf.getPages()[0].getWidth()+0.1);
            for(const r of stripes){
                assert.ok(r.y>=0&&r.x>=0);
                assert.ok(r.y+r.height<=r.pageHeight+0.1);
            }
            const again=await render(fulfillment,size);
            assert.equal(again.rectangles.filter(r=>r.height>30).length,stripes.length);
        }
    }
    const noBarcode=await render({type:'pickup'},'58','invalid');
    assert.equal(noBarcode.rectangles.filter(r=>r.height>30).length,0,'invalid ID must not generate malformed barcode');
    // QR coexistence: GPS QR is smaller modules, barcode remains at top.
    const both=await render({type:'delivery',city:'Nova Hartz',neighborhood:'Centro',
        street:'Rua Fictícia',number:'25',feeCents:700,
        location:{latitude:-29.585,longitude:-50.938}},'58');
    assert.ok(both.rectangles.some(r=>r.height>30),'Code128 missing with GPS');
    assert.ok(both.rectangles.filter(r=>r.height<15).length>80,'GPS QR missing with barcode');
    console.log('PASS Code128-B on 40/58mm/A4 for all order types; no PII, QR preserved.');
})().catch(err=>{console.error(err);process.exitCode=1;});

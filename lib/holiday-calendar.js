'use strict';
// Advisory dates only: no holiday automatically changes the restaurant's hours.
function easter(y){
 const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;
 return new Date(Date.UTC(y,Math.floor(n/31)-1,n%31+1));
}
function calendar(year){
 if(!Number.isInteger(year)||year<2026||year>2100)throw Error('Ano inválido');
 const out=[],add=(day,name,scope,review=false)=>out.push({date:year+'-'+day,name,scope,review});
 for(const [day,name] of [['01-01','Confraternização Universal'],['04-21','Tiradentes'],['05-01','Dia do Trabalho'],['09-07','Independência do Brasil'],['10-12','Nossa Senhora Aparecida'],['11-02','Finados'],['11-15','Proclamação da República'],['11-20','Consciência Negra'],['12-25','Natal']])add(day,name,'nacional');
 add('09-20','Revolução Farroupilha','estadual RS');
 const date=off=>new Date(easter(year).getTime()+off*86400000).toISOString().slice(5,10);
 add(date(-47),'Carnaval','ponto facultativo');
 add(date(-2),'Sexta-feira Santa','religioso',true);
 add(date(0),'Páscoa','comemorativo');
 add(date(60),'Corpus Christi','ponto facultativo / local',true);
 add('12-24','Véspera de Natal','data especial');
 add('12-31','Véspera de Ano-Novo','data especial');
 if(year===2026)add('12-07','Aniversário de Nova Hartz (feriado transferido)','municipal');
 else add('12-02','Aniversário de Nova Hartz — confirmar data oficial','municipal',true);
 return out.sort((a,b)=>a.date.localeCompare(b.date));
}
module.exports={calendar};

"use client";
import { useState } from "react";
function dateKey(date:Date) { return date.toISOString().slice(0,10); }
export function BookingDatePicker({value,min,max,onChange}:{value:string;min:string;max:string;onChange:(value:string)=>void}) {
  const [month,setMonth]=useState(()=>(value||min).slice(0,7));
  const first=new Date(month+"-01T12:00:00Z"),offset=first.getUTCDay();
  const days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate();
  function move(amount:number) {const next=new Date(first);next.setUTCMonth(next.getUTCMonth()+amount);setMonth(dateKey(next).slice(0,7));}
  const heading=first.toLocaleDateString("en-US",{month:"long",year:"numeric",timeZone:"UTC"});
  return <fieldset className="booking-date-picker"><legend>Appointment date</legend>
    <div className="booking-month-nav"><button type="button" aria-label="Previous month" disabled={month<=min.slice(0,7)} onClick={()=>move(-1)}>←</button><strong aria-live="polite">{heading}</strong><button type="button" aria-label="Next month" disabled={month>=max.slice(0,7)} onClick={()=>move(1)}>→</button></div>
    <div className="booking-calendar-weekdays" aria-hidden="true">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day=><span key={day}>{day}</span>)}</div>
    <div className="booking-calendar-days">{Array.from({length:offset},(_,i)=><span key={`blank-${i}`} />)}{Array.from({length:days},(_,i)=>{
      const day=`${month}-${String(i+1).padStart(2,"0")}`,disabled=day<min||day>max;
      return <button type="button" key={day} disabled={disabled} aria-pressed={value===day} aria-current={day===min?"date":undefined} aria-label={new Date(day+"T12:00:00Z").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric",timeZone:"UTC"})} onClick={()=>onChange(day)}>{i+1}</button>;
    })}</div>
    <p className="small-note" aria-live="polite">{value?`Selected: ${new Date(value+"T12:00:00Z").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",timeZone:"UTC"})}`:"Choose a date to see available appointment times."}</p>
  </fieldset>;
}

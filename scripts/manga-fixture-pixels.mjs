// Minimal keyless decoder for our non-interlaced 8-bit RGB/RGBA PNG fixtures.
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
export function fixturePixels(filename) {
  const png=fs.readFileSync(filename),width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  assert.equal(png[24],8);assert.ok([2,6].includes(png[25]));assert.equal(png[28],0);
  const channels=png[25]===2?3:4, stride=width*channels, chunks=[];
  for(let offset=8;offset<png.length;) {
    const size=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8);
    if(type==='IDAT')chunks.push(png.subarray(offset+8,offset+8+size));
    offset+=size+12;
  }
  const compressed=inflateSync(Buffer.concat(chunks)),rgb=new Uint8Array(height*stride);
  let offset=0;
  for(let y=0;y<height;y++) {
    const filter=compressed[offset++];assert.ok(filter<=4);
    for(let x=0;x<stride;x++) {
      const a=x>=channels?rgb[y*stride+x-channels]:0,b=y?rgb[(y-1)*stride+x]:0,c=y&&x>=channels?rgb[(y-1)*stride+x-channels]:0;
      const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
      const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c;
      rgb[y*stride+x]=(compressed[offset++]+predictor)&255;
    }
  }
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++)data.set([rgb[i*channels],rgb[i*channels+1],rgb[i*channels+2],channels===4?rgb[i*channels+3]:255],i*4);
  return {width,height,data,crop(x,y,w,h){
    assert.ok(x>=0&&y>=0&&x+w<=width&&y+h<=height);
    const cropped=new Uint8ClampedArray(w*h*4);
    for(let row=0;row<h;row++)cropped.set(data.subarray(((y+row)*width+x)*4,((y+row)*width+x+w)*4),row*w*4);
    return {data:cropped};
  }};
}

export function movementRoute(message) {
  const text=String(message || '').replace(/@spideyai/gi,'').trim().toLowerCase();
  if(!/^(?:(?:hey|please|can you|could you|would you|spidey)[, ]+)*(?:move|swing|go|do|take|make|shoot|throw|fire|spin|stop|resume|circle|turn|head|run|fly|hang|stay|web|left|right)\b/.test(text) ||
    /\b(?:don't|not|never|instead|unless|except|if)\b/.test(text))return [];
  const route=[];
  const counts={one:1,two:2,three:3,four:4};
  for(const part of text.split(/[,;]|\b(?:and|then)\b/)){
    const lap=/\b(?:laps?|circles?|rounds?|orbits?|clockwise|counterclockwise|anticlockwise)\b/.test(part);
    const steps=lap?[/(?:counter[ -]?clockwise|anticlockwise|anti-clockwise)/.test(part)?'reverse lap':'lap']:
      (part.match(/\b(?:left|right|up|down|top|bottom|webs?|stop|stay|resume)\b/g)||[])
        .map(word=>({top:'up',bottom:'down',webs:'web',stay:'stop'}[word]||word));
    const count=part.match(/\b([1-9]|one|two|three|four)\s+(?:times?|laps?|circles?|rounds?|webs?)\b/);
    const repeats=count?(counts[count[1]]||Number(count[1])):/\btwice\b/.test(part)?2:1;
    for(let i=0;i<repeats;i++)route.push(...steps);
  }
  return route.slice(0,12);
}

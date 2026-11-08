import { MARK } from "@/lib/mark";

// Shown when Almanac opens as an app (the Android app, or added to the Home Screen), once per launch: the "A" rises,
// the "now" line sweeps across, the name and tagline fade in, then it fades into the calendar. Plain CSS (see
// globals.css), so it plays before the page's code loads. It's hidden unless INTRO_SCRIPT switches it on.
export function Intro() {
  const { ink, paper, now, a, line, dot, shift } = MARK;
  return (
    <div className="intro" aria-hidden style={{ background: ink, color: paper }}>
      <svg className="intro-mark" viewBox={`0 ${-shift} 100 100`} width="120" height="120">
        <path className="intro-a" d={a} fill={paper} fillRule="evenodd" />
        <rect className="intro-line" {...line} rx={line.height / 2} fill={now} />
        <circle className="intro-dot" {...dot} fill={now} />
      </svg>
      <p className="intro-name font-serif">ALMANAC</p>
      <p className="intro-tagline font-serif">Never miss what matters.</p>
    </div>
  );
}

// Runs before paint: plays the intro in the app or the installed web app, once per launch, unless the phone
// asks for less motion.
export const INTRO_SCRIPT = `try{if((/AlmanacAndroid\\//.test(navigator.userAgent)||matchMedia('(display-mode: standalone)').matches)&&!sessionStorage.almanacIntro&&!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.dataset.intro='';sessionStorage.almanacIntro='1'}}catch(e){}`;

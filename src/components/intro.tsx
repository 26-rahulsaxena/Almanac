import { MARK, markShapes } from "@/lib/mark";

// Shown when Almanac opens as an app (the Android app, or added to the Home Screen), once per launch: the three
// cards drop into a stack, the front card's lines sweep in and today's dot pops, the name and tagline fade in, then it fades into the calendar. Plain CSS (see
// globals.css), so it plays before the page's code loads. It's hidden unless INTRO_SCRIPT switches it on.
export function Intro() {
  const { ink, paper } = MARK;
  return (
    <div className="intro" aria-hidden style={{ background: ink, color: paper }}>
      <svg className="intro-mark" viewBox="0 0 100 100" width="120" height="120">
        {markShapes(true)}
      </svg>
      <p className="intro-name font-serif">ALMANAC</p>
      <p className="intro-tagline font-serif">Never miss what matters.</p>
    </div>
  );
}

// Runs before paint: plays the intro in the app or the installed web app, once per launch, unless the phone
// asks for less motion.
export const INTRO_SCRIPT = `try{if((/AlmanacAndroid\\//.test(navigator.userAgent)||matchMedia('(display-mode: standalone)').matches)&&!sessionStorage.almanacIntro&&!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.dataset.intro='';sessionStorage.almanacIntro='1'}}catch(e){}`;

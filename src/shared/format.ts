export function formatSecondsToHHMMSSmmm(seconds: number): string {
    const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const h = Math.floor(totalSeconds / 3600) % 24;
    const m = Math.floor(totalSeconds / 60) % 60;
    const sec = totalSeconds % 60;
    const mil = totalMilliseconds % 1000;

    const hh = h < 10 ? '0' + h : String(h);
    const mm = m < 10 ? '0' + m : String(m);
    const ss = sec < 10 ? '0' + sec : String(sec);
    const mmm = mil < 10 ? '00' + mil : mil < 100 ? '0' + mil : String(mil);

    return hh + ':' + mm + ':' + ss + ':' + mmm;
}

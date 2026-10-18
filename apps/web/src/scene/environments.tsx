import type { QualityLevel } from '../store/useApp';
import type { Theme } from './themes';
import { BalloonEnv } from './outdoor/balloon';
import { BoatEnv } from './outdoor/boat';
import { BusEnv } from './outdoor/bus';
import { CloudsEnv } from './outdoor/clouds';
import { PlaneEnv } from './outdoor/plane';

/**
 * Açık hava atmosferleri: bulutların üstü, uçağın üstü, sıcak hava balonu, otobüs ve tekne.
 * Gökyüzü gerçek panoramalardan (Poly Haven), çevre hazır modellerle ve kodla kurulur. Masa ve koltuklar
 * 2.2 m yarıçapında boş bir zeminde kalır; etraf alçak korkuluk ve geniş camlarla açık tutulur.
 */
export function Outdoor({ theme, quality }: { theme: Theme; quality: QualityLevel }) {
  switch (theme.props) {
    case 'clouds':
      return <CloudsEnv theme={theme} quality={quality} />;
    case 'plane':
      return <PlaneEnv theme={theme} quality={quality} />;
    case 'balloon':
      return <BalloonEnv theme={theme} quality={quality} />;
    case 'bus':
      return <BusEnv theme={theme} quality={quality} />;
    case 'boat':
      return <BoatEnv theme={theme} quality={quality} />;
    default:
      return null;
  }
}

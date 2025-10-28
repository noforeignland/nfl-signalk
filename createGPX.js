// createGPX.js
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

class CreateGPX {
  async create(options) {
    await this.writeHeader(options);
    const fileStream = fs.createReadStream(options.input);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (line) {
        try {
          const point = JSON.parse(line);
          // Build trkpt similar to original file (kept structure but fix quoting)
          let trkpt = `  <trkpt lat="${point.lat}" lon="${point.lon}">\n`;
          trkpt += `    <time>${point.t}</time>\n`;
          trkpt += `  </trkpt>\n`;
          fs.appendFileSync(path.join(options.outputDir, 'track.gpx'), trkpt);
        } catch (err) {
          // ignore malformed lines
        }
      }
    }

    await this.writeFooter(options);
    return [path.join(options.outputDir, 'track.gpx')];
  }

  async writeHeader(options) {
    const header = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="signalk-track-logger">\n<trk>\n<trkseg>\n`;
    await fs.writeFile(path.join(options.outputDir, 'track.gpx'), header);
  }

  async writeFooter() {
    const footer = `</trkseg>\n</trk>\n</gpx>\n`;
    await fs.appendFile(path.join(arguments[0]?.outputDir || '.', 'track.gpx'), footer);
  }
}

module.exports = new CreateGPX();

const path = require("path");
const fs = require("fs-extra");
const fg = require("fast-glob");
const { execFile, spawn } = require("promisify-child-process");
const cliProgress = require("cli-progress");

const CONFIG = fs.readJSONSync(path.join(__dirname, "config.json"));

const YTDL_PY = "python3";
const YTDL_PATH = path.resolve(CONFIG.ytdlPath || "/usr/local/bin/youtube-dl");
const YTDL_ARG = [
	YTDL_PATH,
	"--no-warnings",
	"-f",
	"(bestvideo[vcodec^=av01][height>=2160][fps>30]/" +
		"bestvideo[vcodec=vp9.2][height>=2160][fps>30]/" +
		"bestvideo[vcodec=vp9][height>=2160][fps>30]/" +
		"bestvideo[vcodec^=av01][height>=2160]/" +
		"bestvideo[vcodec=vp9.2][height>=2160]/" +
		"bestvideo[vcodec=vp9][height>=2160]/" +
		"bestvideo[height>=2160]/" +
		"bestvideo[vcodec^=av01][height>=1440][fps>30]/" +
		"bestvideo[vcodec=vp9.2][height>=1440][fps>30]/" +
		"bestvideo[vcodec=vp9][height>=1440][fps>30]/" +
		"bestvideo[vcodec^=av01][height>=1440]/" +
		"bestvideo[vcodec=vp9.2][height>=1440]/" +
		"bestvideo[vcodec=vp9][height>=1440]/" +
		"bestvideo[height>=1440]/" +
		"bestvideo[vcodec^=av01][height>=1080][fps>30]/" +
		"bestvideo[vcodec=vp9.2][height>=1080][fps>30]/" +
		"bestvideo[vcodec=vp9][height>=1080][fps>30]/" +
		"bestvideo[vcodec^=av01][height>=1080]/" +
		"bestvideo[vcodec=vp9.2][height>=1080]/" +
		"bestvideo[vcodec=vp9][height>=1080]/" +
		"bestvideo[height>=1080]/" +
		"bestvideo[vcodec^=av01][height>=720][fps>30]/" +
		"bestvideo[vcodec=vp9.2][height>=720][fps>30]/" +
		"bestvideo[vcodec=vp9][height>=720][fps>30]/" +
		"bestvideo[vcodec^=av01][height>=720]/" +
		"bestvideo[vcodec=vp9.2][height>=720]/" +
		"bestvideo[vcodec=vp9][height>=720]/" +
		"bestvideo[height>=720]/" +
		"bestvideo)+(bestaudio[acodec=opus]/" +
		"bestaudio)/" +
		"best",
];
const YTDL_EXECOPT = { maxBuffer: 1000 * 1000 * 2 };

let DONE = false;

console.log("p-backup starting...");

(async () => {
	const SITES = Object.assign(
		(await fg(path.join(__dirname, "sites") + "/*.js")).map((f) => ({
			[path.basename(f, ".js")]: require(f).default,
		}))
	);

	for (const v of CONFIG.playlists) {
		console.log("Checking " + v[0] + "...");

		try {
			await handlePlaylist(v, SITES[Object.entries(SITES).filter((s) => v[1].match(s.match))[0][0]]);
		} catch (error) {
			console.error(error);
			DONE = true;

			break;
		}
	}

	DONE = true;
})();

async function handlePlaylist(v, site) {
	try {
		json = JSON.parse(
			(await execFile(YTDL_PY, [...YTDL_ARG, "-J", "--flat-playlist", "--", v[1]], YTDL_EXECOPT)).stdout
				.toString()
				.split("\n")[0]
		);
	} catch (error) {
		console.error(error);

		return false;
	}

	await fs.ensureDir(path.join(CONFIG.backupPath, v[0]));

	let archive = "";
	let idList = [];

	if (await fs.pathExists(path.join(CONFIG.backupPath, v[0], "archive.log"))) {
		archive = (await fs.readFile(path.join(CONFIG.backupPath, v[0], "archive.log"))).toString();
		idList = archive.split("\n").map((i) => i.replace(" ", ":"));
	}
	if (!json.entries) return console.log("No entries for " + v[0]);

	let missingVideos = [];

	json.entries.forEach((e) => (idList.indexOf(e.url) === -1 ? missingVideos.push(e.url) : ""));

	if (!missingVideos.length) return console.log(v[0] + "'s videos are up to date");
	else {
		console.log("Found " + missingVideos.length + " missing videos, downloading...");

		await downloadPlaylist([v[0], missingVideos], site);
	}
}

async function downloadPlaylist(v, site) {
	for (const [i, url] of v[1].entries()) {
		await download([v[0], url], "#" + i + "/" + v[1].length, [
			"--download-archive",
			path.join(CONFIG.backupPath, v[0], "archive.log"),
		]).then(
			(name) => {
				let fileName = name;

				if (fileName && (site.timeOnFileNameWorkaround || fileName.match(/^NA - /)))
					fileName = fixTimeOnFileName(path.join(__dirname, CONFIG.backupPath, v[0], fileName));

				console.log("#" + i + "/" + v[1].length + " video done: " + fileName);
			},
			(reason) => console.error("#" + i + "/" + v[1].length + " video failed downloading: " + reason)
		);
	}
}

function download(v, i, args) {
	return new Promise((resolve, reject) => {
		const timeStampToMili = (t) => new Date("1/1/1970 " + t).getTime() + 3600000;

		const progress = new cliProgress.SingleBar(
			{ format: i + " {bar} {percentage}% | ETA: {eta}s" },
			cliProgress.Presets.shades_classic
		);
		progress.start(100, 0);

		let fileName = "";

		const video = spawn(
			YTDL_PY,
			[
				...YTDL_ARG,
				...args,
				"--add-metadata",
				"--all-subs",
				"--merge-output-format",
				"mkv",
				"-o",
				`${path.join(__dirname, CONFIG.backupPath, v[0], "%(timestamp)s - %(title)s - %(id)s.%(ext)s")}`,
				"--newline",
				"--postprocessor-args",
				"-strict -2",
				"--",
				v[1],
			],
			YTDL_EXECOPT
		);

		video.catch((err) => reject(err));

		let ytbuf = "";
		video.stdout.on("data", (data) => {
			if (!fileName) {
				ytbuf += data.toString();
				let match = ytbuf.match(/^ *?\[download] Destination: .*\/(.*?)$/m);

				if (match) fileName = match[1].substr(match[1].indexOf("/") + 1);
			}

			let dlMatch = data.toString().match(/^ *?\[download] +?(.+?)%/m);
			if (dlMatch) progress.update(parseFloat(dlMatch[1]));

			let ffMatch =
				data.toString().match(/^ *?\[ffmpeg] Destination: .*\/(.*?)$/m) ||
				data.toString().match(/^ *?\[ffmpeg] Merging formats into ".*\/(.*?)"$/m);
			if (ffMatch) fileName = ffMatch[1].substr(ffMatch[1].indexOf("/") + 1);
		});

		let duration = -1;

		// ffmpeg is on stderr for some reason
		let ffbuf = "";
		video.stderr.on("data", (data) => {
			if (duration === -1) {
				ffbuf += data.toString();
				if (ffbuf.match(/^  Duration: (.*?), start:/m))
					duration = timeStampToMili(ffbuf.match(/^  Duration: (.*?), start:/m)[1]);
			} else if (data.toString().startsWith("frame=")) {
				let match = data.toString().match(/time=(.*?) /);

				if (match) progress.update((timeStampToMili(match[1]) / duration) * 100);
			}
		});

		video.on("close", (code) => {
			progress.stop();
			code ? reject(code) : resolve(fileName);
		});
	});
}

//

function fixTimeOnFileName(filePath) {
	if (path.basename(filePath).match(/^NA - /)) {
		let stat = fs.statSync(filePath);

		fs.renameSync(
			filePath,
			path.join(path.dirname(filePath), path.basename(filePath).replace(/^NA/, Math.round(stat.mtimeMs / 1000)))
		);

		return path.basename(filePath).replace(/^NA/, Math.round(stat.mtimeMs / 1000));
	} else return path.basename(filePath);
}

//

// keep node alive
function wait() {
	if (!DONE) setTimeout(wait, 1000);
}
wait();

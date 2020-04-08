# media-backup

Backup media from multiple sources and keep it up-to-date, using youtube-dl

# Example configuration (config.json)

```json
{
	// folder to backup to
	"backupPath": "../video-backup",

	// path to youtube-dl (optional)
	"ytdlPath": "/home/duncan/youtube-dl-url/bin/youtube-dl",

	// list of playlists to check and backup
	"playlists": [
		["PDRさん", "https://www.youtube.com/user/PDRKabushikigaisha/videos"]
		// ...
	]
}
```

# License

This software is licensed under GNU Affero General Public License v3.0. A copy is available [here](LICENSE).

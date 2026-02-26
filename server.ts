import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route to scrape Tumblr audio
  app.get("/api/scrape/:username", async (req, res) => {
    const { username } = req.params;
    const { path: queryPath } = req.query;
    
    const blogUrl = username.includes(".") ? username : `${username}.tumblr.com`;
    const targetUrl = queryPath ? `https://www.tumblr.com/${username}/${queryPath}` : `https://${blogUrl}/`;
    
    try {
      // Try the legacy JSON API first
      // We'll try to fetch up to 100 posts to get more content including reblogs
      const fetchTracks = async (start = 0) => {
        const apiUrl = `https://${blogUrl}/api/read/json?type=audio&num=50&start=${start}`;
        const response = await axios.get(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 10000
        });
        const rawData = response.data.toString();
        const startIdx = rawData.indexOf('{');
        const endIdx = rawData.lastIndexOf('}');
        if (startIdx === -1 || endIdx === -1) throw new Error("Invalid response format from Tumblr API");
        const jsonStr = rawData.substring(startIdx, endIdx + 1);
        return JSON.parse(jsonStr);
      };

      const data = await fetchTracks(0);
      let allPosts = [...(data.posts || [])];

      // If we have many posts, try to get one more page to ensure we capture reblogs
      if (data['posts-total'] > 50) {
        try {
          const secondPage = await fetchTracks(50);
          if (secondPage && secondPage.posts) {
            allPosts = [...allPosts, ...secondPage.posts];
          }
        } catch (e) {
          console.warn("Failed to fetch second page of tracks");
        }
      }

      const tracks = allPosts.map((post: any) => {
        return {
          id: post.id,
          url: post.url,
          date: post.date,
          type: post.type,
          audioEmbed: post['audio-embed'],
          audioCaption: post['audio-caption'],
          audioFileUrl: post['audio-file-url'],
          artist: post['id3-artist'] || 'Unknown Artist',
          title: post['id3-title'] || 'Unknown Title',
          album: post['id3-album'] || '',
          plays: post['audio-plays'] || 0,
          slug: post.slug,
          rebloggedFrom: post['reblogged-from-name'] || null,
          isReblog: !!post['reblogged-from-url']
        };
      });

      if (tracks.length === 0) {
        throw new Error("No tracks found in API");
      }

      res.json({
        blog: {
          title: data.tumblelog.title,
          name: data.tumblelog.name,
          description: data.tumblelog.description
        },
        tracks
      });

    } catch (error: any) {
      console.error("API Scraping error, trying HTML/RSS fallback:", error.message);
      
      // Fallback: Try RSS feed or HTML scraping
      try {
        const htmlResponse = await axios.get(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 10000
        });
        const html = htmlResponse.data;
        const $ = cheerio.load(html);
        const tracks: any[] = [];

        // 1. Try to find INITIAL_STATE JSON
        const stateMatch = html.match(/window\.___INITIAL_STATE___\s*=\s*({.*?});\s*<\/script>/s) || html.match(/window\.___INITIAL_STATE___\s*=\s*({.*?});/s);
        if (stateMatch) {
          try {
            const state = JSON.parse(stateMatch[1]);
            // Extract posts from various possible locations in the state object
            let posts: any[] = [];
            
            if (state.posts && typeof state.posts === 'object') {
              posts = Object.values(state.posts);
            } else if (state.queries) {
              posts = Object.values(state.queries).flatMap((q: any) => q.posts || []);
            } else if (state.blogPosts && state.blogPosts[username]) {
              posts = state.blogPosts[username].posts || [];
            }

            if (posts.length > 0) {
              posts.forEach((post: any) => {
                // Check for audio in content or post type
                const hasAudioContent = post.content && post.content.some((c: any) => c.type === 'audio');
                if (post.type === 'audio' || hasAudioContent) {
                  const audioContent = post.content?.find((c: any) => c.type === 'audio');
                  tracks.push({
                    id: post.id,
                    title: post.track_name || post.summary || audioContent?.title || 'Audio Track',
                    artist: post.artist || audioContent?.artist || 'Unknown Artist',
                    url: post.post_url || post.url || `https://www.tumblr.com/${username}/${post.id}`,
                    audioEmbed: post.player || post.audio_url || audioContent?.url || (audioContent?.embed_html),
                    isReblog: !!(post.reblogged_from_name || post.parent_post_id),
                    rebloggedFrom: post.reblogged_from_name || post.parent_tumblelog_name,
                    date: post.date || new Date().toISOString()
                  });
                }
              });
            }
          } catch (e) {
            console.warn("Failed to parse INITIAL_STATE", e);
          }
        }

        // 2. If INITIAL_STATE failed, try aggressive HTML selectors
        if (tracks.length === 0) {
          $('article, .post, .post-container, [id^="post-"]').each((i, el) => {
            const $el = $(el);
            const audioIframe = $el.find('iframe[src*="tumblr.com/audio_file"], iframe[src*="tumblr.com/post/"]');
            const hasAudio = audioIframe.length > 0 || $el.find('audio').length > 0 || $el.find('.audio_player').length > 0;
            
            if (hasAudio) {
              const reblogInfo = $el.find('.reblog-link, .reblogged-from, .source-link').first();
              const rebloggedFrom = reblogInfo.text().trim().replace(/^reblogged from\s+/i, '') || null;

              tracks.push({
                id: $el.attr('id') || $el.attr('data-post-id') || `scraped-${i}`,
                title: $el.find('.track-name, .title, h2, h3').first().text().trim() || 'Scraped Track',
                artist: $el.find('.artist, .track-artist').first().text().trim() || 'Unknown Artist',
                url: $el.find('a[href*="/post/"]').first().attr('href') || `https://${blogUrl}/`,
                audioEmbed: audioIframe.length > 0 ? $.html(audioIframe.first()) : null,
                scraped: true,
                isReblog: !!rebloggedFrom,
                rebloggedFrom: rebloggedFrom,
                date: new Date().toISOString()
              });
            }
          });
        }

        if (tracks.length > 0) {
          return res.json({
            blog: { title: username, name: username, description: "Scraped from HTML" },
            tracks
          });
        }

        res.status(404).json({ error: "No audio tracks found. The blog might be empty, private, or using a theme that hides audio posts." });
      } catch (fallbackError: any) {
        res.status(500).json({ error: "Failed to fetch blog data. Please check the username and ensure the blog is public." });
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

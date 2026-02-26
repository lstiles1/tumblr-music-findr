import React, { useState, useEffect, useRef } from "react";
import { Search, Music, ExternalLink, Play, Pause, Disc, AlertCircle, Loader2, User, ArrowUpDown, Filter, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Analytics } from "@vercel/analytics/react";

interface Track {
  id: string;
  url: string;
  date: string;
  type: string;
  audioEmbed?: string;
  audioCaption?: string;
  audioFileUrl?: string;
  artist: string;
  title: string;
  album?: string;
  plays?: number;
  slug?: string;
  scraped?: boolean;
  isReblog?: boolean;
  rebloggedFrom?: string | null;
}

interface BlogInfo {
  title: string;
  name: string;
  description: string;
}

function resolveTrackAudioSource(track: Track): string | null {
  if (track.audioFileUrl) return track.audioFileUrl;

  const embed = track.audioEmbed?.trim();
  if (!embed) return null;

  if (/^https?:\/\//i.test(embed)) {
    return embed;
  }

  const audioTagMatch = embed.match(/<audio[^>]*src=["']([^"']+)["']/i);
  if (audioTagMatch?.[1]) {
    return audioTagMatch[1].replace(/&amp;/g, "&");
  }

  const iframeSrcMatch = embed.match(/<iframe[^>]*src=["']([^"']+)["']/i);
  if (iframeSrcMatch?.[1]) {
    const iframeSrc = iframeSrcMatch[1].replace(/&amp;/g, "&");
    try {
      const parsedUrl = new URL(iframeSrc);
      const audioFileParam = parsedUrl.searchParams.get("audio_file");
      if (audioFileParam) {
        return decodeURIComponent(audioFileParam);
      }
    } catch {
      // Keep iframe source as best-effort fallback.
    }
    return iframeSrc;
  }

  return null;
}

export default function App() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blogInfo, setBlogInfo] = useState<BlogInfo | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [filterTerm, setFilterTerm] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const history = localStorage.getItem("tumblr_search_history");
    if (history) {
      setSearchHistory(JSON.parse(history));
    }
  }, []);

  useEffect(() => {
    const handleGlobalShortcuts = (event: KeyboardEvent) => {
      // "/" focuses the primary search input, mirroring common dashboard UX patterns.
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        usernameInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleGlobalShortcuts);
    return () => window.removeEventListener("keydown", handleGlobalShortcuts);
  }, []);

  useEffect(() => {
    const pauseOtherMediaOnPlay = (event: Event) => {
      const activeMedia = event.target;
      if (!(activeMedia instanceof HTMLMediaElement)) return;

      document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {
        if (media !== activeMedia && !media.paused) {
          media.pause();
        }
      });
    };

    // Capture play events globally so only one media element plays at once.
    document.addEventListener("play", pauseOtherMediaOnPlay, true);
    return () => {
      document.removeEventListener("play", pauseOtherMediaOnPlay, true);
    };
  }, []);

  const saveToHistory = (name: string) => {
    const newHistory = [name, ...searchHistory.filter(h => h !== name)].slice(0, 5);
    setSearchHistory(newHistory);
    localStorage.setItem("tumblr_search_history", JSON.stringify(newHistory));
  };

  const handleScrape = async (targetUsername?: string) => {
    const query = targetUsername || username;
    if (!query) return;

    setLoading(true);
    setLoadingStage("Connecting to Tumblr...");
    setError(null);
    setTracks([]);
    setBlogInfo(null);
    setExpandedTrackId(null);

    try {
      let cleanUsername = query.replace(/^https?:\/\//, "").replace(/\/$/, "");
      let postPath = "";
      
      if (cleanUsername.includes("tumblr.com")) {
        const parts = cleanUsername.split("/");
        if (parts[0].includes("www.tumblr.com") || parts[0] === "tumblr.com") {
          // Handle www.tumblr.com/username/postid/...
          cleanUsername = parts[1];
          if (parts.length > 2) {
            postPath = parts.slice(2).join("/");
          }
        } else {
          // Handle username.tumblr.com/post/postid/...
          cleanUsername = parts[0].split(".")[0];
          if (parts.length > 1) {
            postPath = parts.slice(1).join("/");
          }
        }
      } else {
        // Handle raw username
        cleanUsername = cleanUsername.split("/")[0];
      }

      setLoadingStage(`Scanning @${cleanUsername}...`);
      const apiUrl = `/api/scrape/${cleanUsername}${postPath ? `?path=${encodeURIComponent(postPath)}` : ""}`;
      let data: any = null;
      let lastError: unknown = null;

      // Retry once to smooth over cold-start races when the service is just booting.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(apiUrl);
          const contentType = response.headers.get("content-type") || "";

          if (!response.ok) {
            if (attempt === 0 && response.status >= 500) {
              setLoadingStage("Waking up scraper service...");
              await new Promise((resolve) => setTimeout(resolve, 700));
              continue;
            }
            throw new Error(`Request failed with status ${response.status}`);
          }

          if (!contentType.includes("application/json")) {
            throw new Error("Unexpected response format");
          }

          data = await response.json();
          break;
        } catch (err) {
          lastError = err;
          if (attempt === 0) {
            setLoadingStage("Waking up scraper service...");
            await new Promise((resolve) => setTimeout(resolve, 700));
            continue;
          }
        }
      }

      if (!data) {
        throw lastError || new Error("Unable to reach scraper service");
      }

      if (data.error) {
        setError(data.error);
      } else {
        setBlogInfo(data.blog);
        setTracks(data.tracks);
        saveToHistory(cleanUsername);
      }
    } catch (err) {
      setError("Failed to connect to the findr service.");
    } finally {
      setLoading(false);
    }
  };

  const filteredAndSortedTracks = tracks
    .filter((track) => {
      const term = filterTerm.toLowerCase();
      return (
        track.title?.toLowerCase().includes(term) ||
        track.artist?.toLowerCase().includes(term) ||
        track.album?.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

  return (
    <div className="min-h-screen bg-[#36465d] text-[#ffffff] font-sans selection:bg-[#529ecc] selection:text-[#ffffff]">
      {/* Header / Hero */}
      <header className="bg-[#36465d] border-b border-[#6f7b8b]/55 pt-12 pb-8 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row md:items-end justify-between gap-8"
          >
            <div className="max-w-xl">
              <h1 className="text-5xl md:text-7xl font-bold leading-[0.92] tracking-[-0.015em] mb-4 font-serif">
                tumblr findr <br />
              </h1>
              <p className="max-w-lg text-sm md:text-[15px] opacity-75 leading-relaxed">
                Extract and explore audio tracks from any public Tumblr profile. 
                Enter a username or blog URL to begin.
              </p>
            </div>

            <div className="w-full md:w-[420px] md:self-end">
              <div className="relative group rounded-full bg-[#ffffff]/95 border border-[#9099a6]/45 p-1 shadow-md shadow-[#202a3a]/20">
                <input
                  ref={usernameInputRef}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScrape()}
                  placeholder="Username or blog URL..."
                  aria-label="Tumblr username or blog URL"
                  className="w-full bg-transparent text-[#36465d] border border-transparent focus:border-[#529ecc]/70 rounded-full py-3 pl-10 pr-24 transition-all outline-none text-[15px] font-medium placeholder:text-[#6f7b8b]"
                />
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-[#6f7b8b] opacity-80 group-focus-within:opacity-100 transition-opacity" />
                <button
                  onClick={() => handleScrape()}
                  disabled={loading}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#529ecc] text-[#ffffff] px-4 py-1.5 rounded-full font-bold text-sm hover:bg-[#36465d] active:scale-95 transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Find"}
                </button>
              </div>
              
              {searchHistory.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {searchHistory.map((h) => (
                    <button
                      key={h}
                      onClick={() => {
                        setUsername(h);
                        handleScrape(h);
                      }}
                      className="text-[10px] font-bold uppercase tracking-wider bg-[#9099a6]/30 hover:bg-[#9099a6]/50 px-2 py-1 rounded-md transition-colors"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#6f7b8b]/40 border border-[#9099a6]/60 p-6 rounded-3xl flex items-start gap-4 mb-8"
            >
              <AlertCircle className="w-6 h-6 text-[#ffffff] shrink-0 mt-1" />
              <div>
                <h3 className="font-bold text-[#ffffff]">Scraping Failed</h3>
                <p className="text-[#ffffff]/85 text-sm">{error}</p>
              </div>
            </motion.div>
          )}

          {blogInfo && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-10"
            >
              <div className="flex items-center gap-4 mb-4 rounded-xl border border-[#6f7b8b]/60 bg-[#ffffff]/5 p-4">
                <div className="w-14 h-14 bg-[#6f7b8b]/35 rounded-xl shadow-sm flex items-center justify-center border border-[#9099a6]/45">
                  <User className="w-8 h-8 opacity-20" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">{blogInfo.title}</h2>
                  <p className="text-xs opacity-65">@{blogInfo.name}.tumblr.com</p>
                </div>
              </div>
              {blogInfo.description && (
                <div 
                  className="text-sm opacity-60 max-w-2xl prose prose-sm"
                  dangerouslySetInnerHTML={{ __html: blogInfo.description }}
                />
              )}
            </motion.div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <Loader2 className="w-12 h-12 animate-spin opacity-20" />
              <div className="text-center">
                <p className="text-sm font-bold uppercase tracking-widest opacity-30 animate-pulse">Gathering Music Tracks</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-20 mt-2">{loadingStage}</p>
              </div>
            </div>
          ) : tracks.length > 0 ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid gap-4"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold uppercase tracking-widest text-[#ffffff] whitespace-nowrap">{filteredAndSortedTracks.length} Tracks Found</span>
                  <div className="h-px w-12 bg-[#9099a6]/70" />
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative rounded-full border border-[#9099a6]/55 bg-[#ffffff]/95 shadow-sm">
                    <input
                      type="text"
                      placeholder="Search tracks..."
                      value={filterTerm}
                      onChange={(e) => setFilterTerm(e.target.value)}
                      aria-label="Filter tracks by title, artist, or album"
                      className="bg-transparent text-[#36465d] border border-transparent rounded-full py-2 pl-9 pr-4 text-xs focus:border-[#529ecc] outline-none transition-all w-48 placeholder:text-[#6f7b8b]"
                    />
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6f7b8b] opacity-80" />
                    {filterTerm && (
                      <button
                        onClick={() => setFilterTerm("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[#9099a6]/25 transition-colors"
                        aria-label="Clear track filter"
                        title="Clear filter"
                      >
                        <X className="w-3.5 h-3.5 text-[#6f7b8b]" />
                      </button>
                    )}
                  </div>
                  
                  <button
                    onClick={() => setSortOrder(sortOrder === "newest" ? "oldest" : "newest")}
                    className="flex items-center gap-2 bg-[#ffffff]/95 text-[#36465d] border border-[#9099a6]/60 rounded-full py-2 px-4 text-xs font-bold shadow-sm hover:bg-[#529ecc] hover:text-[#ffffff] hover:border-[#529ecc] transition-colors"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    {sortOrder === "newest" ? "Newest First" : "Oldest First"}
                  </button>
                </div>
              </div>
              
              {filteredAndSortedTracks.map((track, idx) => (
                <React.Fragment key={track.id}>
                  <TrackCard
                    track={track}
                    index={idx}
                    isExpanded={expandedTrackId === track.id}
                    onToggleExpanded={() =>
                      setExpandedTrackId((prev) => (prev === track.id ? null : track.id))
                    }
                  />
                </React.Fragment>
              ))}
              
              {filteredAndSortedTracks.length === 0 && (
                <div className="py-12 text-center">
                  <p className="opacity-50 italic">No tracks match your search criteria.</p>
                  <button
                    onClick={() => setFilterTerm("")}
                    className="mt-4 text-xs font-bold uppercase tracking-widest bg-[#ffffff] text-[#36465d] border border-[#9099a6]/50 px-3 py-2 rounded-lg hover:bg-[#9099a6]/20 transition-colors"
                  >
                    Reset Filter
                  </button>
                </div>
              )}
            </motion.div>
          ) : !loading && !error && (
            <div className="flex flex-col items-center justify-center py-24 text-center opacity-20">
              <Disc className="w-24 h-24 mb-4 animate-spin-slow" />
              <p className="text-lg font-medium italic font-serif">Waiting for a blog to explore...</p>
            </div>
          )}
        </AnimatePresence>
      </main>

      <Analytics />
    </div>
  );
}

function TrackCard({
  track,
  index,
  isExpanded,
  onToggleExpanded,
}: {
  track: Track;
  index: number;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}): React.JSX.Element {
  const resolvedAudioSource = resolveTrackAudioSource(track);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isExpanded || typeof window === "undefined" || window.innerWidth >= 768) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isExpanded]);

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, iframe, audio, video")) return;
    onToggleExpanded();
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggleExpanded();
    }
  };

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      className="group bg-[#ffffff] text-[#36465d] rounded-lg border border-[#9099a6]/45 shadow-sm hover:border-[#529ecc]/75 hover:shadow-md hover:-translate-y-px transition-all overflow-hidden cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#529ecc]/45"
    >
      <div className="p-3.5 sm:p-4 flex items-center gap-3 sm:gap-4">
        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#9099a6]/15 border border-[#9099a6]/35 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-[#529ecc] group-hover:text-[#ffffff] transition-colors">
          <Music className="w-4.5 h-4.5 sm:w-5 sm:h-5" />
        </div>
        
        <div className="grow min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-bold leading-tight group-hover:text-[#529ecc] transition-colors overflow-hidden [display:-webkit-box] [-webkit-line-clamp:3] sm:[-webkit-line-clamp:2] [-webkit-box-orient:vertical] md:block md:truncate">
              {track.title || "Untitled Track"}
            </h3>
          </div>
          <p className="text-xs text-[#6f7b8b] truncate">
            {track.artist || "Unknown Artist"} {track.album ? `• ${track.album}` : ""}
          </p>
          {track.rebloggedFrom && (
            <p className="text-[10px] text-[#6f7b8b] mt-0.5">
              via <span className="font-bold">@{track.rebloggedFrom}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 opacity-100 transition-opacity">
          <a 
            href={track.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="hidden sm:inline-flex p-2 hover:bg-[#9099a6]/25 rounded-lg transition-colors"
            title="Open on Tumblr"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <button 
            onClick={onToggleExpanded}
            className="bg-[#529ecc] text-[#ffffff] px-3 sm:px-4 py-1.5 rounded-md text-xs font-bold hover:bg-[#36465d] active:scale-95 transition-colors"
          >
            {isExpanded ? "Close" : "Listen"}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-[#9099a6]/45 bg-[#f8fafc] overflow-hidden"
          >
            <div className="p-6">
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-4">Player</h4>
                  {resolvedAudioSource ? (
                    <InlineAudioPlayer
                      src={resolvedAudioSource}
                      title={track.title || "Untitled Track"}
                      artist={track.artist || "Unknown Artist"}
                      postUrl={track.url}
                    />
                  ) : (
                    <div className="p-8 bg-[#ffffff] rounded-xl border border-[#9099a6]/50 flex flex-col items-center justify-center text-center">
                      <AlertCircle className="w-8 h-8 opacity-20 mb-2" />
                      <p className="text-xs opacity-50">Direct embed not available for this track.</p>
                      <a 
                        href={track.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="mt-4 text-[10px] font-bold uppercase tracking-widest underline"
                      >
                        Listen on Tumblr
                      </a>
                    </div>
                  )}
                </div>
                
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-4">Info</h4>
                  <div className="space-y-3">
                    <MetaItem label="Artist" value={track.artist} />
                    <MetaItem label="Title" value={track.title} />
                    <MetaItem label="Album" value={track.album || "N/A"} />
                    <MetaItem label="Date" value={new Date(track.date).toLocaleDateString()} />
                    {track.rebloggedFrom && <MetaItem label="Source" value={`@${track.rebloggedFrom}`} />}
                    <div className="pt-2">
                      <a 
                        href={track.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest bg-[#9099a6]/25 text-[#36465d] px-3 py-2 rounded-lg hover:bg-[#9099a6]/40 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" /> Open Post
                      </a>
                    </div>
                  </div>
                  
                  {track.audioCaption && (
                    <div className="mt-6 pt-6 border-t border-[#9099a6]/60">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-2">Caption</h4>
                      <div 
                        className="text-xs opacity-60 prose prose-xs max-w-none"
                        dangerouslySetInnerHTML={{ __html: track.audioCaption }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function MetaItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-start gap-1 md:flex-row md:items-center md:justify-between md:gap-4">
      <span className="text-[10px] font-bold uppercase tracking-wider opacity-30">{label}</span>
      <span className="text-xs font-medium w-full md:w-auto md:max-w-[200px] wrap-break-word">{value}</span>
    </div>
  );
}

function InlineAudioPlayer({
  src,
  title,
  artist,
  postUrl,
}: {
  src: string;
  title: string;
  artist: string;
  postUrl: string;
}): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setAudioError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);
    const handleError = () => {
      setIsPlaying(false);
      setAudioError("Playback was blocked or unavailable. Open the Tumblr post to listen.");
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioError(null);
    if (audio.paused) {
      void audio.play().catch(() => {
        setIsPlaying(false);
        setAudioError("Playback was blocked or unavailable. Open the Tumblr post to listen.");
      });
    } else {
      audio.pause();
    }
  };

  const seekTo = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  };

  const formatTime = (seconds: number) => {
    const safe = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const maxDuration = duration || 0;
  const clampedTime = Math.min(currentTime, maxDuration);

  return (
    <div className="rounded-xl border border-[#9099a6]/45 bg-[#ffffff] px-4 py-4 shadow-sm">
      <audio ref={audioRef} src={src} preload="metadata" />

      <div className="mb-4">
        <p className="text-base font-bold leading-tight wrap-break-word">{title}</p>
        <p className="text-sm text-[#6f7b8b] truncate">{artist}</p>
      </div>

      <div className="mb-5">
        {audioError ? (
          <div className="rounded-xl border border-[#9099a6]/55 bg-[#9099a6]/10 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 text-[#36465d]/80 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-[#36465d]/80">Audio Unavailable</p>
                <p className="text-xs text-[#6f7b8b] mt-1">{audioError}</p>
                <a
                  href={postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#36465d] underline underline-offset-2"
                >
                  <ExternalLink className="w-3 h-3" /> Open Post
                </a>
              </div>
            </div>
          </div>
        ) : (
          <>
            <input
              type="range"
              min={0}
              max={maxDuration}
              step={0.1}
              value={clampedTime}
              onChange={(e) => seekTo(Number(e.target.value))}
              aria-label="Seek audio"
              className="w-full h-2 accent-[#36465d] cursor-pointer"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-[#6f7b8b] tabular-nums">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-center">
        {!audioError && (
          <button
            onClick={togglePlay}
            className="p-3 rounded-full bg-[#36465d] text-[#ffffff] hover:bg-[#529ecc] transition-colors shadow-sm"
            aria-label={isPlaying ? "Pause audio" : "Play audio"}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
          </button>
        )}
      </div>
    </div>
  );
}

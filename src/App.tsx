import React, { useState, useEffect } from "react";
import { Search, Music, ExternalLink, Play, Pause, Disc, Info, AlertCircle, Loader2, User, Heart, Share2, ArrowUpDown, Filter } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

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

  useEffect(() => {
    const history = localStorage.getItem("tumblr_search_history");
    if (history) {
      setSearchHistory(JSON.parse(history));
    }
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
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (data.error) {
        setError(data.error);
      } else {
        setBlogInfo(data.blog);
        setTracks(data.tracks);
        saveToHistory(cleanUsername);
      }
    } catch (err) {
      setError("Failed to connect to the scraper service.");
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
    <div className="min-h-screen bg-[#f5f5f5] text-[#1a1a1a] font-sans selection:bg-[#000] selection:text-[#fff]">
      {/* Header / Hero */}
      <header className="bg-white border-b border-black/5 pt-12 pb-8 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row md:items-end justify-between gap-6"
          >
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                  <Music className="w-5 h-5 text-white" />
                </div>
                <span className="text-xs font-bold uppercase tracking-widest opacity-40">Archive Explorer</span>
              </div>
              <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-none mb-4">
                Tumblr Audio <br />
                <span className="italic font-serif font-light opacity-60">Scraper</span>
              </h1>
              <p className="max-w-md text-sm opacity-60 leading-relaxed">
                Extract and explore audio tracks from any public Tumblr profile. 
                Enter a username or blog URL to begin your sonic excavation.
              </p>
            </div>

            <div className="w-full md:w-96">
              <div className="relative group">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScrape()}
                  placeholder="Username or blog URL..."
                  className="w-full bg-[#f0f0f0] border-2 border-transparent focus:border-black rounded-2xl py-4 pl-12 pr-4 transition-all outline-none text-lg font-medium"
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 opacity-30 group-focus-within:opacity-100 transition-opacity" />
                <button
                  onClick={() => handleScrape()}
                  disabled={loading}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black text-white px-4 py-2 rounded-xl font-bold text-sm hover:scale-105 active:scale-95 transition-transform disabled:opacity-50 disabled:scale-100"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Scrape"}
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
                      className="text-[10px] font-bold uppercase tracking-wider bg-black/5 hover:bg-black/10 px-2 py-1 rounded-md transition-colors"
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

      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-red-50 border border-red-100 p-6 rounded-3xl flex items-start gap-4 mb-8"
            >
              <AlertCircle className="w-6 h-6 text-red-500 shrink-0 mt-1" />
              <div>
                <h3 className="font-bold text-red-900">Scraping Failed</h3>
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            </motion.div>
          )}

          {blogInfo && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-12"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-black/5">
                  <User className="w-8 h-8 opacity-20" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{blogInfo.title}</h2>
                  <p className="text-sm opacity-50">@{blogInfo.name}.tumblr.com</p>
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
                <p className="text-sm font-bold uppercase tracking-widest opacity-30 animate-pulse">Sonic Excavation in Progress</p>
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
                  <span className="text-xs font-bold uppercase tracking-widest opacity-40 whitespace-nowrap">{filteredAndSortedTracks.length} Tracks Found</span>
                  <div className="h-[1px] w-12 bg-black/5" />
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search tracks..."
                      value={filterTerm}
                      onChange={(e) => setFilterTerm(e.target.value)}
                      className="bg-white border border-black/5 rounded-xl py-2 pl-9 pr-4 text-xs focus:border-black outline-none transition-all w-48"
                    />
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-30" />
                  </div>
                  
                  <button
                    onClick={() => setSortOrder(sortOrder === "newest" ? "oldest" : "newest")}
                    className="flex items-center gap-2 bg-white border border-black/5 rounded-xl py-2 px-4 text-xs font-bold hover:bg-black/5 transition-colors"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    {sortOrder === "newest" ? "Newest First" : "Oldest First"}
                  </button>
                </div>
              </div>
              
              {filteredAndSortedTracks.map((track, idx) => (
                <React.Fragment key={track.id}>
                  <TrackCard track={track} index={idx} />
                </React.Fragment>
              ))}
              
              {filteredAndSortedTracks.length === 0 && (
                <div className="py-12 text-center opacity-30 italic">
                  No tracks match your search criteria.
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

      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-black/5 text-center opacity-30 text-xs font-bold uppercase tracking-widest">
        &copy; {new Date().getFullYear()} Tumblr Audio Scraper &bull; Built with precision
      </footer>
    </div>
  );
}

function TrackCard({ track, index }: { track: Track; index: number }): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group bg-white rounded-2xl border border-black/5 hover:border-black/20 transition-all overflow-hidden"
    >
      <div className="p-4 flex items-center gap-4">
        <div className="w-12 h-12 bg-[#f9f9f9] rounded-xl flex items-center justify-center shrink-0 group-hover:bg-black group-hover:text-white transition-colors">
          <Music className="w-6 h-6" />
        </div>
        
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-bold truncate leading-tight group-hover:text-black transition-colors">
              {track.title || "Untitled Track"}
            </h3>
            {track.isReblog && (
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider bg-black/5 px-1.5 py-0.5 rounded text-black/40">
                <Share2 className="w-2 h-2" /> Reblog
              </span>
            )}
          </div>
          <p className="text-xs opacity-50 truncate">
            {track.artist || "Unknown Artist"} {track.album ? `• ${track.album}` : ""}
          </p>
          {track.rebloggedFrom && (
            <p className="text-[10px] opacity-30 mt-0.5">
              via <span className="font-bold">@{track.rebloggedFrom}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 hover:bg-black/5 rounded-lg transition-colors"
            title="View Details"
          >
            <Info className="w-4 h-4" />
          </button>
          <a 
            href={track.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="p-2 hover:bg-black/5 rounded-lg transition-colors"
            title="Open on Tumblr"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="bg-black text-white px-4 py-2 rounded-xl text-xs font-bold hover:scale-105 active:scale-95 transition-transform"
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
            className="border-t border-black/5 bg-[#fafafa] overflow-hidden"
          >
            <div className="p-6">
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-4">Player</h4>
                  {track.audioEmbed ? (
                    <div 
                      className="tumblr-embed w-full rounded-xl overflow-hidden bg-white shadow-sm border border-black/5"
                      dangerouslySetInnerHTML={{ __html: track.audioEmbed }}
                    />
                  ) : (
                    <div className="p-8 bg-white rounded-xl border border-black/5 flex flex-col items-center justify-center text-center">
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
                  <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-4">Metadata</h4>
                  <div className="space-y-3">
                    <MetaItem label="Artist" value={track.artist} />
                    <MetaItem label="Title" value={track.title} />
                    <MetaItem label="Album" value={track.album || "N/A"} />
                    <MetaItem label="Date" value={new Date(track.date).toLocaleDateString()} />
                    {track.rebloggedFrom && <MetaItem label="Source" value={`@${track.rebloggedFrom}`} />}
                    {track.audioFileUrl && (
                      <div className="pt-2">
                        <a 
                          href={track.audioFileUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest bg-black text-white px-3 py-2 rounded-lg hover:scale-105 transition-transform"
                        >
                          <Play className="w-3 h-3" /> Direct Audio Link
                        </a>
                      </div>
                    )}
                  </div>
                  
                  {track.audioCaption && (
                    <div className="mt-6 pt-6 border-t border-black/5">
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
    <div className="flex justify-between items-center gap-4">
      <span className="text-[10px] font-bold uppercase tracking-wider opacity-30">{label}</span>
      <span className="text-xs font-medium truncate max-w-[200px]">{value}</span>
    </div>
  );
}

import { Navigate, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'

import { useAuth } from '../auth/AuthContext'
import { findLesson, listProgressByUser, saveWatchProgress } from '../data/lmsRepository'
import type { Lesson } from '../types/lms'

type YouTubePlayerState = {
  PLAYING: number
  PAUSED: number
  ENDED: number
}

type YouTubePlayer = {
  destroy?: () => void
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime?: () => number
  getDuration?: () => number
}

type YouTubeReadyEvent = {
  target: YouTubePlayer
}

type YouTubeStateChangeEvent = {
  data: number
}

type YouTubePlayerOptions = {
  videoId: string
  playerVars?: Record<string, unknown>
  events?: {
    onReady?: (event: YouTubeReadyEvent) => void
    onStateChange?: (event: YouTubeStateChangeEvent) => void
  }
}

type YouTubeGlobal = {
  Player?: new (elementId: string, options: YouTubePlayerOptions) => YouTubePlayer
  PlayerState?: YouTubePlayerState
}

declare global {
  interface Window {
    YT?: YouTubeGlobal
    onYouTubeIframeAPIReady?: () => void
  }
}

export const WatchPage = () => {
  const { lessonId } = useParams()
  const { user } = useAuth()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [loading, setLoading] = useState(true)
  const [savedSeconds, setSavedSeconds] = useState(0)
  const initialSeekRef = useRef(0)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const autoSaveTimerRef = useRef<number | null>(null)

  const stopAutoSave = () => {
    if (autoSaveTimerRef.current) {
      window.clearInterval(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
  }

  const persistProgress = async (seconds: number, totalSeconds: number) => {
    if (!user || !lesson) return

    const roundedSeconds = Math.max(0, Math.floor(seconds))
    const roundedTotal = Math.max(0, Math.floor(totalSeconds))
    const completed = roundedTotal > 0 && roundedSeconds / roundedTotal >= 0.9

    setSavedSeconds(roundedSeconds)
    await saveWatchProgress({
      userId: user.id,
      lessonId: lesson.id,
      watchedSeconds: roundedSeconds,
      totalSeconds: roundedTotal,
      isCompleted: completed,
    })
  }

  useEffect(() => {
    const load = async () => {
      if (!lessonId) {
        setLoading(false)
        return
      }

      const found = await findLesson(lessonId)
      setLesson(found)

      if (found && user) {
        const progress = await listProgressByUser(user.id)
        const current = progress.find((item) => item.lessonId === found.id)
        const initial = current?.watchedSeconds ?? 0
        initialSeekRef.current = initial
        setSavedSeconds(initial)
      }

      setLoading(false)
    }

    void load()

    return () => {
      stopAutoSave()
      if (playerRef.current?.destroy) {
        playerRef.current.destroy()
      }
    }
  }, [lessonId, user])

  useEffect(() => {
    if (!lesson) return

    const mountPlayer = () => {
      if (!window.YT?.Player) return

      if (playerRef.current?.destroy) {
        playerRef.current.destroy()
      }

      playerRef.current = new window.YT.Player('yt-player', {
        videoId: lesson.youtubeVideoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          start: initialSeekRef.current,
        },
        events: {
          onReady: (event) => {
            if (initialSeekRef.current > 0) {
              event.target.seekTo(initialSeekRef.current, true)
            }
          },
          onStateChange: (event) => {
            const state = window.YT?.PlayerState

            if (event.data === state?.PLAYING) {
              stopAutoSave()
              autoSaveTimerRef.current = window.setInterval(() => {
                const currentTime = Number(playerRef.current?.getCurrentTime?.() ?? 0)
                const duration = Number(playerRef.current?.getDuration?.() ?? 0)
                void persistProgress(currentTime, duration)
              }, 5000)
            }

            if (event.data === state?.PAUSED || event.data === state?.ENDED) {
              stopAutoSave()
              const currentTime = Number(playerRef.current?.getCurrentTime?.() ?? 0)
              const duration = Number(playerRef.current?.getDuration?.() ?? 0)
              void persistProgress(currentTime, duration)
            }
          },
        },
      })
    }

    if (window.YT?.Player) {
      mountPlayer()
      return
    }

    const existingScript = document.getElementById('youtube-iframe-api')
    if (!existingScript) {
      const script = document.createElement('script')
      script.id = 'youtube-iframe-api'
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      document.body.append(script)
    }

    window.onYouTubeIframeAPIReady = () => {
      mountPlayer()
    }

    return () => {
      stopAutoSave()
    }
  }, [lesson])

  const handleSave = async () => {
    const currentTime = Number(playerRef.current?.getCurrentTime?.() ?? savedSeconds)
    const duration = Number(playerRef.current?.getDuration?.() ?? 0)
    await persistProgress(currentTime, duration)
  }

  if (loading) {
    return <section><p className="muted">読み込み中...</p></section>
  }

  if (!lesson) {
    return <Navigate to="/" replace />
  }

  return (
    <section>
      <h1>{lesson.title}</h1>
      <p className="muted">YouTube動画を埋め込み再生し、5秒ごとの進捗保存を想定したUIです。</p>

      <div className="video-wrap">
        <div id="yt-player" className="yt-player" />
      </div>

      <div className="inline-actions">
        <button type="button" className="button primary" onClick={() => void handleSave()}>
          現在位置を保存
        </button>
        <span className="muted">保存済み: {savedSeconds} 秒</span>
      </div>
    </section>
  )
}

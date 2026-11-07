import { Link } from 'react-router-dom'
import { CircleHelp } from 'lucide-react'
import { helpLesson, lessonById } from './model.js'
import { helpTime } from './videoModel.js'
import { fp } from '../../template/ful/paths'
import './training.css'

// P872 — the "?" on a VA task (Queue, phone, booking, servicing, schedule): opens the lesson for that job. Help is
// always there, even before the lesson is reached on the training path (only its check waits its turn).
export function HelpDot({ lesson, inline = false, onGo }) {
  const id = helpLesson(lesson)
  if (!id) return null
  const title = lessonById(id).title
  const at = helpTime(id, lesson) // P877: open the lesson's video at the moment this task is shown
  return (
    <Link to={`${fp('training', id)}?from=help${at != null ? `&t=${at}` : ''}`} className={`tr-help${inline ? ' is-inline' : ''}`} aria-label={`How to: ${title}`} title={`How to: ${title}`} onClick={onGo}>
      <CircleHelp size={inline ? 14 : 16} aria-hidden="true" />{inline && <span>How to</span>}
    </Link>
  )
}

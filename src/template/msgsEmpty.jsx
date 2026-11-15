import { MessageSquare } from 'lucide-react'
import { NO_CONV, NO_CONV_SUB } from './msgsEmptyText.js'

// P1013 follow-up (Brayden, Nov 15): Messages keeps its full box when there are no conversations yet. The list shows
// this calm note inside the box (Ohvara Support, where a role has it, stays above it) and the right pane shows the
// "Pick a conversation" placeholder. Every role, desktop and phone.
export function ListEmpty({ who }) {
  return <div className="tp-empty tp-msgs-empty" role="status"><b>{NO_CONV}</b><span>{NO_CONV_SUB[who]}</span></div>
}

export function PickConversation() {
  return (
    <div className="tp-conv-pick" role="status">
      <MessageSquare size={26} aria-hidden="true" />
      <b>Pick a conversation</b>
      <span>Choose someone on the left to read and reply.</span>
    </div>
  )
}

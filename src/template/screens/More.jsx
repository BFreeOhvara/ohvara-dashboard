import { Navigate } from 'react-router-dom'
import { paths } from '../paths'

// P969: the desktop Account / More page is gone ("makes no sense"). Its address lands on Overview; what only lived
// here is in the profile pop-up (top-right avatar) and Settings. The phone's More screen is m/MMore.jsx.
export default function More() {
  return <Navigate to={paths.home()} replace />
}

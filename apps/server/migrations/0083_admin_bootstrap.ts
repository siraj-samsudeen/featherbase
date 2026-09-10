// #130: recorded 0006 databases may have a locked Administrator. An explicit
// password can provision that account; existing hashes are never rotated.
export { bootstrapAdministrator as up } from '../src/admin-bootstrap'

# Codex-Style Multi-Device Redesign Plan

This checklist tracks the staged redesign of Remote Kanna toward a denser Codex-like, multi-device workflow.

## Phase 0: Stabilize

- [x] Keep `tsc --noEmit` green before each UI slice.
- [x] Keep focused sidebar/chat tests green before each push.
- [x] Commit and push completed slices before larger follow-up work.
- [ ] Add broader coverage when sidebar routing and search behavior settle.

## Phase 1: Sidebar Hierarchy

- [x] Render General Chat as a global top-level area outside devices.
- [x] Render active device selector directly below General Chat.
- [x] Add device-scoped actions: New Chat, Search, Plugins, Skills.
- [x] Filter Projects to the active device.
- [x] Show project chats nested below each project.
- [x] Keep project menus: new chat, open folder/editor, copy path, rename, archived chats, hide.
- [x] Add a Projects context menu with Hidden Projects.
- [x] Allow a General Chat conversation to be linked into an existing project.

## Phase 2: Multi-Device Model

- [ ] Strengthen shared types around Machine, Project, Chat, capabilities, file entries, plugin state, and skill state.
- [ ] Ensure every project/chat carries machine id, project id, path, provider availability, and online state.
- [ ] Separate discovered projects from saved/opened projects without losing chat history.

## Phase 3: File Explorer

- [x] Add right-sidebar project file tree.
- [x] Support local file tree listing.
- [x] Support remote file tree listing over SSH.
- [ ] Add file read/preview APIs for remote projects.
- [ ] Add project file search.

## Phase 4: Search

- [ ] Add sidebar search overlay/page.
- [ ] Search chats, projects, files, skills, and plugins.
- [ ] Add filters: current device, all devices, current project.

## Phase 5: Skills

- [ ] Scan skills per device.
- [ ] Show install state matrix by device.
- [ ] Add install, sync, compare versions, open `SKILL.md`, remove, and update actions.

## Phase 6: Plugins

- [ ] Scan plugins per device.
- [ ] Show enabled/missing/error state matrix by device.
- [ ] Add install, enable/disable, dependency/config status, and sync actions.

## Phase 7: Visual Polish

- [ ] Flatten sidebar styling and reduce card-like grouping.
- [ ] Use 32-38px rows, muted labels, 6-8px radius, subtle hover states.
- [ ] Keep composer wide and centered with aligned attachment/send controls.
- [ ] Validate desktop/mobile screenshots before large visual commits.

import { create } from "zustand";
import { ipc } from "@/lib/ipc-client";
import type { Project } from "@/types/ipc";

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  loading: boolean;
  loadProjects: () => Promise<void>;
  addProject: (path: string) => Promise<Project>;
  openFolder: () => Promise<Project | null>;
  removeProject: (id: string) => Promise<void>;
  setActiveProject: (id: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProjectId: null,
  loading: false,

  loadProjects: async () => {
    set({ loading: true });
    try {
      const projects = await ipc.invoke("project:list");
      set({ projects, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  addProject: async (path: string) => {
    const project = await ipc.invoke("project:add", path);
    set((state) => ({
      projects: [project, ...state.projects],
      activeProjectId: project.id,
    }));
    return project;
  },

  openFolder: async () => {
    const project = await ipc.invoke("project:openFolder");
    if (project) {
      set((state) => {
        const exists = state.projects.some((p) => p.id === project.id);
        return {
          projects: exists ? state.projects : [project, ...state.projects],
          activeProjectId: project.id,
        };
      });
    }
    return project;
  },

  removeProject: async (id: string) => {
    await ipc.invoke("project:remove", id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      activeProjectId:
        state.activeProjectId === id ? null : state.activeProjectId,
    }));
  },

  setActiveProject: (id: string | null) => {
    set({ activeProjectId: id });
  },
}));

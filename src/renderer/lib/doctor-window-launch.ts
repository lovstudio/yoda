import { isDoctorWindowSearch } from '@shared/doctor-window';

export const isDoctorWindowLaunch = isDoctorWindowSearch(window.location.search);

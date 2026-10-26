import "../styles/styles.css";
import "../styles/admin.css";
import Admin from "../admin/Admin.jsx";
import { mount } from "./mount.jsx";

if (location.protocol !== "file:") mount(<Admin />);

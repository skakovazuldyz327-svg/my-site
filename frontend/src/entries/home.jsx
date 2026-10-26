import "../styles/styles.css";
import Layout from "../components/Layout.jsx";
import Home from "../pages/Home.jsx";
import { mount } from "./mount.jsx";

mount(
  <Layout page="home">
    <Home />
  </Layout>
);

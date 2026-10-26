import "../styles/styles.css";
import Layout from "../components/Layout.jsx";
import Products from "../pages/Products.jsx";
import { mount } from "./mount.jsx";

mount(
  <Layout page="products">
    <Products />
  </Layout>
);

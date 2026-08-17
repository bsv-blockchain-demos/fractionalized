import { useParams } from "react-router-dom";
import { PropertyDetails } from "@/components/property-details";

export default function PropertyDetailPage() {
    const { propertyId } = useParams();

    if (!propertyId) return null;

    return (
        <div>
            <PropertyDetails propertyId={propertyId} />
        </div>
    );
}
